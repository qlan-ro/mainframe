# Automations

An Automation is **When** (one or more triggers) + **Do** (a linear list of
steps). Definitions live in the app's SQLite database — there is no YAML
file to edit or sync. Full product rationale: `docs/designs/2026-07-11-automations-v2-spec.md`.

## The model

Steps come from four verbs, plus two block types for structure:

| Verb | Purpose |
|---|---|
| `ask_agent` | Send a prompt to a new agent session; the run waits for the reply. |
| `ask_me` | Pause and show a form; the run resumes once answered. |
| `run_action` | Call a deterministic action (built-in, curated connector, or MCP tool) — no agent involved. |
| `notify` | Send a desktop/mobile notification. |

| Block | Purpose |
|---|---|
| `if` | Structured `⟨token⟩ · comparator · value` conditions, `then`/`otherwise` branches. |
| `repeat` | Iterate a list-typed token; steps inside see `⟨current⟩`. |

Data flows through **tokens** (`TokenRef {stepId, output, field?}`), not
expressions. Text fields hold `ChipText` — a mix of literal text and token
references — substituted literally at run time (no filters, no functions).
Reserved `stepId`s: `trigger` (trigger context), `builtin` (`today`, `now`),
`current` (the Repeat item).

## Storage

- `<dataDir>/automations.db` — a separate SQLite file from `mainframe.db`,
  WAL mode. Tables: `automations`, `automation_runs`,
  `automation_interactions`.
- `<dataDir>/automation-credentials.json` (mode 0600) — action credentials
  and webhook signing secrets (reserved label `webhook:<hookId>`).
- Runs are checkpointed after every step, so they survive daemon restarts.
  A run's frozen `definition` snapshot lives inside its checkpoint, so
  editing an automation never shifts step references of an in-flight run.

## REST API

All responses use the WS4 envelope (`{success, data}` or `{success:false, error}`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/automations` | List automations |
| `POST` | `/api/automations` | Create an automation |
| `GET` | `/api/automations/:id` | Get an automation |
| `PUT` | `/api/automations/:id` | Update an automation |
| `DELETE` | `/api/automations/:id` | Delete an automation |
| `PATCH` | `/api/automations/:id/enabled` | Arm/disarm triggers (`{ enabled }`); manual runs stay allowed either way |
| `POST` | `/api/automations/:id/runs` | Start a manual run (202 Accepted) |
| `GET` | `/api/automations/:id/runs` | List runs for an automation |
| `GET` | `/api/automation-runs/:id` | Run detail — status + step timeline |
| `POST` | `/api/automation-runs/:id/cancel` | Cancel a running or waiting run |
| `GET` | `/api/automation-interactions` | List pending `ask_me` interactions |
| `POST` | `/api/automation-interactions/:id/respond` | Submit form answers (`{ response: { ... } }`) |
| `GET` | `/api/automation-actions` | Action catalog (built-ins, connectors, MCP tools) |
| `GET` | `/api/automation-credentials` | List credential labels (never values) |
| `GET` | `/api/automation-credentials/:label` | Get a credential's kind (never its value) |
| `PUT` | `/api/automation-credentials/:label` | Store a credential token |
| `DELETE` | `/api/automation-credentials/:label` | Delete a credential |
| `POST` | `/api/automation-webhooks/:hookId` | Webhook ingress (see below) |

Step timeline entries truncate their output preview at 32 KB.

## Webhooks

`POST /api/automation-webhooks/:hookId` is auth-exempt (matched by path, not
by token) and requires a valid HMAC-SHA256 signature over the raw request
body. Compute it as:

```
sha256=<lowercase-hex of HMAC-SHA256(secret, rawBody)>
```

Send it in `X-Signature` or GitHub's `X-Hub-Signature-256` header; the
comparison uses `crypto.timingSafeEqual`. The per-hook secret is stored
under the reserved credential label `webhook:<hookId>`.

GitHub "PR opened"/"PR merged" triggers ship as webhook presets: the route
matches the preset's predicate (event + action, e.g. `pull_request` +
`opened`) after signature verification and before starting a run — a
non-matching delivery gets a 204 and starts nothing. Deliveries dedup on
GitHub's `X-GitHub-Delivery` header (or a required `id` field), so retried
deliveries never double-fire a run.

## WebSocket events

| Event | Payload |
|---|---|
| `automation.run.updated` | `{run}` |
| `automation.interaction.created` | `{interaction}` |
| `automation.interaction.resolved` | `{interactionId, runId}` |
| `automation.completed` | `{automationId, automationName, runId, status: 'succeeded'\|'failed', result}` — feeds both the "automation finishes" and "automation fails" triggers; there is no separate event per trigger kind |
| `automation.notification` | `{runId, automationId, title, body, links: {runId, chatIds}}` |

## Actions — ids and outputs

`run_action` steps call one of these by id. Output names are camelCase on
the wire; a no-output action has an empty outputs list.

| id | outputs |
|---|---|
| `run_command` | `output: text`, `exitCode: number` |
| `files.append` | *(none)* |
| `files.write` | *(none)* |
| `files.read` | `content: text` |
| `http.request` | `status: number`, `body: text` |
| `github.create_pr` | `prUrl: text`, `prNumber: number` |
| `github.list_prs` | `prs: list` (items: `{url, title, number, author}`) |
| `notion.add_row` | `pageUrl: text` |
| `ado.create_item` | `workItemId: number`, `url: text` |
| `mcp:<server>:<tool>` | `result: text` (+ structured content when present) |
| `ask_agent` (verb, not an action id) | `result: text`, `chatId: text`, plus any keys declared in `expects` |

`run_command` spawns via `zsh -lc` (array args, never string-interpolated
shell). Chips inside the script are never spliced into shell source: each
becomes an `MF_<n>` environment variable and the script gets a quoted
`"$MF_<n>"` where the chip sat, so untrusted token content (webhook
payloads, PR titles) can't inject shell commands.

## Env flags

| Variable | Effect | Default |
|---|---|---|
| `AUTOMATIONS_MCP_ENABLED` | Enables MCP server discovery and `mcp:<server>:<tool>` actions in the catalog | off (post-launch feature, not yet wired) |
| `DESCRIBE_ENABLED` | Enables the "describe it" natural-language drafting entry point in the editor | off (no drafting endpoint yet) |

## Spec

Product spec: `docs/designs/2026-07-11-automations-v2-spec.md`.
Wire contract (types, storage, routes, action table): `docs/plans/2026-07-12-automations-v2-contract.md`.
