# Automations — what is not built (2026-08-18)

Audit of the shipped Automations v2 feature: `packages/core-rs/crates/mainframe-automations`
(the only engine — `packages/core` was deleted in c470bb1f, and no
`MAINFRAME_DAEMON_IMPL` gate remains) plus `packages/ui/src/features/automations`.

Baseline used: `packages/types/src/automation.ts` (the wire contract in code),
`docs/guides/AUTOMATIONS.md`, and a live query against the running daemon on
:31415. The authoritative contract/spec docs live on the `docs/automations-v2-plans`
branch, which is not present locally or on any reachable remote, so contract
section numbers below are quoted from in-code references rather than read.

## Verdict

The engine implements the ratified v2 contract fully; the gaps are in the surface around
it — plus a set of control-flow primitives the contract never included (§C2).
Triggers (schedule incl. `once`/`onMissed`, event,
webhook with HMAC + preset predicates + permanent replay dedup), all seven step
kinds incl. `set_variable`/`if`/`repeat`, checkpoint-resume, cancel semantics, and
all 9 catalog actions (`run_command`, `files.read/write/append`, `http.request`,
`github.create_pr`, `github.list_prs`, `notion.add_row`, `ado.create_item`) are
implemented and covered by 331 lib + 17 conformance test functions.

(`github_issues.rs` also lives in this crate but is not an automation action — it is
the tasks-board two-way GitHub sync from #559, consumed by `mainframe-plugins`.)

What is missing is the **authoring and integration surface around it**. One of those
gaps makes `run_action` unusable in the shipped app.

---

## A. Broken in production — `run_action` renders an empty parameter form

The daemon publishes each action's `paramsSchema` as **JSON Schema**:

```
$ curl -s localhost:31415/api/automation-actions
… "id":"run_command","paramsSchema":{"type":"object","properties":{"script":…,"runIn":…},"required":["script","runIn"]} …
```

The editor only understands a different, UI-local shape — `{fields: [...]}`:

- `packages/ui/src/features/automations/steps/action-fields.ts:58` — `asActionParamsSchema()`
  reads `paramsSchema.fields`; when it isn't an array it returns `{fields: []}`.
- `packages/ui/src/features/automations/steps/ActionConfig.tsx:62` — feeds that
  straight into `AutoForm`. There is no per-action-id overlay table anywhere.

Nothing in the daemon emits `fields`, so **every** catalog entry falls into the
empty-form branch. Concretely, in the shipped app you can add a `run_action` step and
pick "Run command", but there is no script field, no `runIn` selector, and no
"Treat output as" segment (`hasOutputAs` is also false).

Nothing catches it on save either: `domain/validate.rs:174` checks only that
`action_id` is non-empty for a `run_action` step and never validates `params` against
the action's schema. So the step saves clean with `params: {}` and fails at run time
inside the action's own `parse_input`, since `script` and `runIn` are required.

The `{fields}` shape exists only in `fixtures/action-catalog.ts`, which is wired to
`fixture-gateway.ts` (tests/dev double). Production uses `data/http-gateway.ts` →
`listAutomationActions`. The mismatch is acknowledged in the `action-fields.ts` header
comment ("no plan has ratified its shape yet") but no translation layer was built on
either side.

**Not built:** either a JSON-Schema→field-schema adapter in the UI, or a `fields`
projection on the Rust `ActionCatalogEntry`.

## B. Built but flag-gated / dead

| Gap | Evidence |
|---|---|
| **MCP actions** — `mcp:<server>:<tool>` is in the contract, the docs, and the `ActionCatalogEntry.group` enum. No discovery, no execution, no `AUTOMATIONS_MCP_ENABLED` read anywhere in `core-rs`; the flag name survives only in a UI fixture comment. `ActionCatalogEntry::mcp_seam()` is dead code — never called. | `actions/registry.rs:63`; `fixtures/action-catalog.ts:6` |
| **"Describe it" NL drafting** — full UI exists (`describe/DescribeFlow.tsx`, `DraftPreview.tsx`) but is hard-off, because no drafting route exists server-side. | `flags.ts:10` (`DESCRIBE_ENABLED = false`); `library/LibraryList.tsx:84` |

## C. Stubbed — the field is on the wire, the behavior isn't

| Gap | Evidence |
|---|---|
| **`ask_agent.autoApprove`** — accepted by the editor and persisted; the agent port logs a warning and drops it. No ChatManager parameter exists (R6). | `mainframe-server/src/automations_deps/agent.rs:135-140` |
| **`ask_agent.attachments`** — same: authoring-only. No upload or storage path, and the UI's own picker synthesizes placeholder filenames rather than opening a file dialog. | `agent.rs:143-146`; `steps/AttachmentsField.tsx:1-20` |
| **Credentials have no token-entry field** — "Connect" writes the literal string `placeholder-token-<service>` and shows a connected pill. The `PUT /api/automation-credentials/:label` route works and stores arbitrary tokens; nothing in the UI ever calls it with user input. Both token-auth connectors (Notion, ADO) are therefore unusable from the app. Note this is *not* an OAuth gap — neither connector uses OAuth (Notion takes a bearer token, ADO a PAT over basic auth), so the missing piece is a text input, not a flow. | `steps/CredentialConnect.tsx:43`; `actions/ado.rs:125`; `actions/notion.rs:105` |
| **`run_command` `runIn: "worktree"` always fails** — `ActionCtx.worktree_path` is hardcoded `None` at the call site, so the mode the schema advertises errors out at run time by design ("fails loudly"). | `engine/run_action_verb.rs:73-76`; `actions/run_command.rs:147-149` |
| **Webhook sample capture** — the daemon *does* capture the last delivery per hook, but only in memory, and no route exposes it. The editor card explicitly states the promise is unrouted, so there is no "use a real payload to build tokens" flow. | `triggers/webhook_ingest.rs:79-80`; `editor/WebhookTriggerCard.tsx:6` |
| **Notion column picker** — flagged in the contract as an explicit gap ("needs a schema-lookup endpoint the contract lacks"). The daemon's schema is `{databaseId, additionalProperties: string}`, so it's freeform key/value typing; the `columns` control and its `columnsByOption` map exist only in the fixture. | `actions/notion.rs:70-79`; `steps/action-fields.ts:4` |

## C2. Control flow — the engine is sequential end to end

Listing "all seven step kinds incl. `set_variable`/`if`/`repeat`" above understates what is
missing, so to be explicit. `walk_frame` is `for step in steps { … .await }`
(`engine/walk.rs:51`) and `run_repeat` awaits each iteration in order
(`engine/blocks.rs:70`); the engine's only `tokio::spawn`s are the agent watch and cancel,
and `run_locks.in_flight` serializes concurrent `advance()` calls per run. So there is:

- **no parallelism of any kind** — no parallel block, no concurrent `repeat`;
- **no re-evaluated loop** — `repeat`'s item list resolves once before the loop and cannot
  grow, so no `while`/`until`/`do-while`, no loop-until-dry, no poll-until-ready;
- **no retry primitive** — the lone `can_retry` (`engine/agent_settle.rs:45`) is a single
  corrective nudge for an `ask_agent` reply that fails its `expects` JSON parse;
- **no break/continue/early exit** — `keepGoing` means "carry on past a failure", not
  "leave the loop";
- **no sub-automation call** — chaining is only via the `automation.finished`/`.failed`
  event triggers, i.e. a separate run with its own checkpoint and no argument passing.

There is also **no `wait`/sleep step**, so even once a loop exists, a polling loop would
hot-spin — and `blocks.rs:15` already flags that each pass rewrites the whole checkpoint JSON.

A multi-agent review panel, a poll-until-green loop, and a retry wrapper are all currently
inexpressible.

**These are deliberate launch scope, not defects.** "No loops or branching" was named as a
known limitation in the v2 design discussion (2026-07-26) and the linear-Do model is what
the contract ratified — the engine implements that contract fully. This section records
what the ratified model can't express, which matters now that people want to run todo-lanes
through it. Plan for closing it: Part 3 of
`docs/plans/2026-08-18-automations-provider-connections-plan.md`.

## D. Absent surfaces

- **Mobile has no Automations surface at all** — no file under `packages/mobile` mentions
  automations. A pending `ask_me` interaction blocks its run until someone opens the
  desktop app; the mobile client cannot list or answer them.
- **No public webhook ingress.** `routes/automations/registration.rs:83` hardcodes
  `http://127.0.0.1:{port}/api/automation-webhooks/{hookId}`, so GitHub cannot reach a
  hook without the user wiring their own forwarding. Both that file's comment and
  `WebhookTriggerCard.tsx`'s justify this with "the daemon has no public tunnel" — which
  is now stale: `/health` returns a live `tunnelUrl` (`https://mainframe-tunnel.qlan.ro`).
  Routing registration through the existing tunnel looks like the missing piece, not a
  new transport.
- **Webhook signing secret is unrecoverable by design gap** — returned only in the register
  response, held in component state, never re-readable. Reload the editor and the only way
  back is another register call.
- **Docs drift:** `POST /api/automations/:id/webhooks/:triggerId/register` is implemented
  (`routes/automations.rs:257`) but absent from the route table in `docs/guides/AUTOMATIONS.md`.

## E. Test coverage gaps

`packages/e2e/tests-tauri/automations-library.spec.ts` is the only E2E spec: 6 tests,
all library-level (delete confirm/cancel, project-scope badges, scope filtering). Nothing
exercises the editor, a run, an `ask_me` interaction, or a webhook end to end — which is
why finding A shipped undetected. The Rust conformance suite is fakes-only and structurally
cannot see a UI/daemon schema mismatch.

## F. Known cross-engine follow-up, now moot

The tracked `⟨result⟩` same-millisecond tiebreak divergence (BTreeMap lex-order vs Node
insertion-order, task_84fe900c) is no longer a divergence — the Node engine is deleted.
Whether the Rust ordering alone is correct is worth one look, but there is no second arm
to reconcile with.

---

## Note on the connectors specifically

The four connector actions are **not** stubs — the engine side of each is finished and
tested against mock servers. `ado.create_item` (`actions/ado.rs`) POSTs a real JSON-patch
document to `https://dev.azure.com/{org}/{project}/_apis/wit/workitems/${type}?api-version=7.1`,
maps `System.Title`/`System.Description`, and reads `id` + `_links.html.href` back into its
`workItemId`/`url` outputs; 5 tests cover the roundtrip, the strict-input rejection, and
401 credential naming. Nothing about the connectors themselves needs building.

If the credential work is ever revisited as OAuth rather than a token field, two facts
constrain it and should be checked before design starts. **Azure DevOps OAuth is being
retired** — Microsoft stopped accepting new app registrations in April 2025 and sunsets
the platform in 2026, so the target would have to be Microsoft Entra ID OAuth (an MSAL
public client can use PKCE, so no secret needs to ship) or delegation to `az` CLI on the
`gh` precedent. **Notion cannot be done secret-free**: its token endpoint authenticates
with HTTP Basic over `CLIENT_ID:CLIENT_SECRET` and the docs describe no PKCE path, so a
desktop binary would need a hosted token-exchange proxy. Separately, `CredentialKind` has
exactly one variant (`Token`) with no expiry or refresh fields, and storage is plaintext
JSON at 0600 — unattended scheduled runs on expiring OAuth tokens would need refresh
machinery in the engine and a keychain store first.

Their two blockers are both in the authoring layer, and they are ordered: finding A first
(no params form → no `org`/`project`/`type`/`title` to send, and `parse_input` fails before
auth is ever reached), then the credential text field. Helpfully, the fixture's ADO field
keys already match the daemon's schema exactly, so the fixture is a valid reference for
what an adapter should produce. One divergence to watch: the fixture's
`credentialLabelHint` is `'Azure DevOps'` while the daemon sends `'ado'` — the label the
credential gets stored under follows whichever catalog the UI read.

## If you fix one thing

Finding A. It is a ~30-line adapter, it silently disables a whole verb, and the tests that
would have caught it are the ones listed in E.
