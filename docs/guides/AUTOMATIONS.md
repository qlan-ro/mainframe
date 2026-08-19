# Automations

An Automation is **When** (one or more triggers) + **Do** (a linear list of
steps). Definitions live in the app's SQLite database — there is no YAML
file to edit or sync. Full product rationale: `docs/designs/2026-07-11-automations-v2-spec.md`.

## The model

Steps come from seven verbs, plus five block types for structure:

| Verb | Purpose |
|---|---|
| `ask_agent` | Send a prompt to a new agent session; the run waits for the reply. |
| `ask_me` | Pause and show a form; the run resumes once answered. |
| `run_action` | Call a deterministic action (built-in, curated connector, or MCP tool) — no agent involved. |
| `notify` | Send a desktop/mobile notification. |
| `set_variable` | Name a value once; later steps address it as `$name`. |
| `wait` | Park the run for a fixed delay (`seconds`, capped at 7 days), then carry on. |
| `break` | Leave the innermost enclosing `loop`/`repeat`. |

| Block | Purpose |
|---|---|
| `if` | Structured `⟨token⟩ · comparator · value` conditions, `then`/`otherwise` branches. |
| `repeat` | Iterate a list-typed token; steps inside see `⟨current⟩`. `concurrency` (`2`–`32`) runs that many iterations at once instead of one at a time; absent or `1` is sequential. |
| `loop` | Repeat `while`/`until` a condition, re-tested each pass. Requires `maxIterations` (≤ 500); exhausting it **fails** the block. |
| `retry` | Re-run the body from the top on failure, up to `maxAttempts`. Every attempt re-runs side effects — there is no idempotence guard. |
| `parallel` | Run 2–32 authored branches (each its own step list) at once, wait-for-all. A failed branch does not stop its siblings; the reported error is the lowest-indexed branch's. `break` cannot cross into or out of a branch. |

Both `repeat`'s `concurrency` and `parallel` share one caveat: only steps that
*wait* — `ask_agent`, `ask_me`, `wait` — genuinely overlap in wall-clock
time. Local work inside a single branch or iteration still runs one step at
a time; concurrency is about how many chats/forms/timers can be outstanding
at once, not about parallelizing CPU-bound work.

Data flows through **tokens** (`TokenRef {stepId, output, field?}`), not
expressions. Text fields hold `ChipText` — a mix of literal text and token
references — substituted literally at run time (no filters, no functions).
Reserved `stepId`s: `trigger` (trigger context), `builtin` (`today`, `now`),
`current` (the Repeat item).

## Storage

- `<dataDir>/automations.db` — a separate SQLite file from `mainframe.db`,
  WAL mode. Tables: `automations`, `automation_runs`,
  `automation_interactions`.
- Action credentials and webhook signing secrets (reserved label
  `webhook:<hookId>`) live in the OS keychain when one is available — the
  daemon logs which backend won at boot. `<dataDir>/automation-credentials.json`
  (mode 0600) is the fallback for a machine with no usable keychain (headless
  Linux, no secret service running); an existing plaintext file migrates into
  the keychain automatically the first time a usable one is found, and is
  deleted once every credential has moved across.
- A run's `wakeAt` is resolved by a 30-second sweep, which is why it is also a
  `wait` step's resolution — a wait resumes on the first sweep at or after its
  deadline, so short waits round up. The same sweep enforces `ask_agent`'s
  `timeoutMinutes`; one `wakeAt` carries both meanings, discriminated by the
  parked step's kind.
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
| `POST` | `/api/automation-credentials/github/device/start` | Start a GitHub OAuth device-flow session |
| `POST` | `/api/automation-credentials/github/device/poll` | One poll attempt against the pending device-flow session (`{deviceCode}`); a `connected` result stores the token under the `github` label |
| `POST` | `/api/automation-webhooks/:hookId` | Webhook ingress (see below) |
| `POST` | `/api/notifications` | Raise a standalone, run-less notification (`{title, body, links?}`) — see below |

Step timeline entries truncate their output preview at 32 KB.

## Standalone notifications

`POST /api/notifications` broadcasts `notification.created` and mirrors it to
mobile push, best-effort (a push failure never fails the request). It exists
for work launched *outside* an automation run that still needs to notify
natively — an `ask_agent` step spawns a Claude CLI session, which has no
`PushNotification` harness tool, so a todo-lane run scheduled by an
automation would otherwise be silent. `~/.claude/skills/todo-lane/scripts/lane_apply.py`
posts here from its `start`/`finish` stage transitions.

Like the webhook route, a loopback caller reaches this with no token
(`middleware/auth.rs` — loopback is never rejected); unlike the webhook
route, it needs no path exemption because it isn't auth-exempt for anyone
else. `title` is required and rejected if empty; `body` and `links` are
optional.

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
deliveries never double-fire a run — the dedup key is a permanent unique
index, so it defends against a replay at any distance in time, not just a
bounded window.

Senders that stamp their own send time — an `X-Timestamp` header, or a
top-level `timestamp` payload field (unix seconds, unix milliseconds, or ISO
8601) — get an extra check: a delivery older than 10 minutes is dropped with
204 before it reaches dedup or run-start. GitHub's own deliveries carry no
such field, so this window never applies to them; they rely solely on the
permanent dedup index above, which for an already-seen id is the stronger
guarantee of the two.

A delivery whose run failed to start for a reason other than a duplicate
(e.g. the daemon's automations DB is unreachable) gets a 500 so the sender's
own retry logic re-delivers it; a duplicate delivery is a no-op 200, and a
non-matching preset is a 204 — none of the three leave a run silently lost.

## WebSocket events

| Event | Payload |
|---|---|
| `automation.run.updated` | `{run}` |
| `automation.interaction.created` | `{interaction}` |
| `automation.interaction.resolved` | `{interactionId, runId}` |
| `automation.completed` | `{automationId, automationName, runId, status: 'succeeded'\|'failed', result}` — feeds both the "automation finishes" and "automation fails" triggers; there is no separate event per trigger kind |
| `automation.notification` | `{runId, automationId, title, body, links: {runId, chatIds}}` |
| `notification.created` | `{title, body, links?: {chatIds}}` — a standalone notification with no run behind it (`POST /api/notifications`); the toast degrades to no action when `links` is absent |

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

The two `github.*` actions call the GitHub REST API directly (`POST
/repos/:repo/pulls`, `GET /search/issues`) with a bearer token stored under
the `github` credential label — same shape as `notion`/`ado`, connected via
the editor's GitHub device-flow button rather than a pasted token. A step
saved before this migration carries no `credential` label (the old manifest
declared `auth: none`, since `gh` held the token); `run_action` defaults a
`credential`-less GitHub step to the well-known `github` label so it resolves
against whatever is connected instead of running unauthenticated.

GitHub is the only provider that gets OAuth: its device flow needs no client
secret and no redirect URI. Notion and Azure DevOps get a token-paste field
instead — Notion's token endpoint requires a server-side secret this app
can't ship, and Azure DevOps' legacy OAuth platform stopped accepting new
registrations in April 2025. The Azure DevOps token must be
organization-scoped: Microsoft stops issuing global PATs on 2026-03-15 and
decommissions them on 2026-12-01.

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

## GitHub OAuth App setup

The GitHub device-flow connect button needs a registered OAuth App with
device flow enabled. Until one is registered, `GITHUB_OAUTH_CLIENT_ID` in
`packages/core-rs/crates/mainframe-automations/src/github_device.rs` is
empty and `POST /api/automation-credentials/github/device/start` answers
501; the editor shows GitHub as unavailable rather than failing obscurely.
Register the app (device flow enabled, no redirect URI needed — it never
redirects) and set the constant to its client ID, which is a public
identifier and carries no secret.

## Spec

Product spec: `docs/designs/2026-07-11-automations-v2-spec.md`.
Wire contract (types, storage, routes, action table): `docs/plans/2026-07-12-automations-v2-contract.md`.
