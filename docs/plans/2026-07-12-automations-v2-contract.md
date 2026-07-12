# Automations v2 — Ratified Cross-Plan Contract

Single source of truth for every wire shape shared by the three v2 plans
(`2026-07-12-automations-v2-node-refactor.md`, `…-rust-engine.md`, `…-ui.md`).
Where a plan disagrees with this document, this document wins. Ratified
2026-07-12 after reconciling the two daemon plans; A1–A3 are product
amendments approved in review (spec updated to match).

## 1. Type model (`@qlan-ro/mainframe-types`, Node plan Task 1 is the reference)

- Step kinds: `ask_agent | ask_me | run_action | notify | if | repeat`
  (Rust plan renames `notify_me` → `notify`).
- `TokenRef = {stepId, output, field?}` — flat, no tagged kinds. Reserved
  stepIds: `trigger`, `builtin` (outputs `today`, `now`), `current`.
  `field` is a dot-path string into structured values.
- `ChipPart = string | {token: TokenRef}`; `ChipText = ChipPart[]`.
- Comparators: `is | is_not | contains | starts_with | eq | lt | gt |
  is_empty | not_empty | is_one_of` (A3). `contains` is polymorphic:
  substring on text, membership on list. `is_one_of` takes an array value.
- Schedule trigger: `{schedule: SchedulePattern, onMissed: 'run_once'|'skip'}`
  (Rust renames `missedRun`/`catch_up_once`). `every_n_hours` compiles to
  `0 */n * * *`; all schedules run in local time.
- Event trigger union: `session.finished | automation.finished |
  automation.failed` only. GitHub PR opened/merged ship as **webhook
  presets** (Rust drops `github_pr_*` from its event enum and does not
  poll; its EventSource trait carries app events only).
- Run statuses: `running | waiting | succeeded | failed | cancelled`.
  Interaction statuses: `pending | answered | cancelled` (Node adds
  `cancelled` on run-cancel; interactions never expire).

## 2. Checkpoint JSON (shared `automation_runs.checkpoint` column)

Node plan Task 3 shape is canonical:
`{steps: Record<stepRef, {stepId, kind, status: 'succeeded'|'failed'|'waiting'|'skipped',
outputs: Record<string, unknown> | null, error, startedAt, finishedAt,
chatId?, interactionId?}>, wakeAt: number|null, error: string|null}`.
- Rust renames `entries` → `steps` and adopts **named outputs** (a record
  keyed by output name — required by `TokenRef.output`).
- `stepRef` = `<stepId>` top-level/If-branch, `<stepId>#<iteration>` inside
  Repeat, suffixes chained for nesting. Per-step outputs cap: 4 MB, failing
  loudly with the "write large data to a file" message.

## 3. Storage

- Contract tables (3): `automations`, `automation_runs`,
  `automation_interactions` — exactly as briefed. DB file
  `<dataDir>/automations.db`, WAL, busy_timeout 5000.
- Node's `trigger_state` and `agent_waits` are **engine-internal rebuildable
  caches, NOT contract**. Rust keeps its derived-state design and does not
  mirror them. Both engines must ignore unknown tables in the shared file.
  Single-writer-at-a-time stands (switchover story owned by the future
  daemon-port plan).
- Credentials: `<dataDir>/automation-credentials.json`, 0600. Webhook
  signing secrets live there under reserved labels `webhook:<hookId>`.

## 4. REST + WS

- Webhook ingress: `POST /api/automation-webhooks/:hookId` (auth-exempt,
  HMAC-SHA256 via timing-safe compare, accepts `X-Signature` and GitHub's
  `X-Hub-Signature-256`). Rust renames its `/hooks/...` route and
  `X-Mainframe-Signature` header. Last payload sample: persisted by Node
  (trigger_state), in-memory in the standalone Rust binary — both acceptable;
  exposure to the editor is a UI-plan integration point, not yet routed.
- WS events (5, not 4): the briefed four **plus**
  `automation.notification {runId, automationId, title, body,
  links: {runId, chatIds}}`. `automation.completed` payload =
  `{automationId, automationName, runId, status: 'succeeded'|'failed',
  result: string}` and serves both chaining triggers.
- Timeline entry + preview truncation (32 KB) per Node plan Task 24.

## 5. Actions

- Ids: `run_command`, `files.append`, `files.write`, `files.read`,
  `http.request`, `github.create_pr`, `github.list_prs`, `notion.add_row`,
  `ado.create_item`, `mcp:<server>:<tool>` (Rust splits its single `files`
  action and renames `http`). Output names per Node plan Task 12–15
  (`output`, `exit_code`, `pr_url`, `pr_number`, `prs`, `page_url`,
  `work_item_id`, `content`, `status`, `body`, `result`).
- `run_command` shell: `zsh -lc` with array args on macOS (`sh -lc`
  fallback where zsh is absent). See A1.

## 6. Amendments (spec updated; each daemon plan adds tasks)

- **A1 — env-var injection for `run_command` (closes Rust R7).** Chips are
  never spliced into shell source. Each chip becomes `MF_<n>` in the child
  env; the script text substitutes a quoted `"$MF_<n>"` where the chip sat.
  Only author-typed literal text is shell source. Applies to the `cwd`
  param too. UI shows a "what will run" preview (UI plan).
- **A2 — structured agent outputs.** `ask_agent` gains
  `expects?: Array<{key, type: 'text'|'number'|'list'|'choice', options?}>`.
  Engine appends the output contract to the session, parses the final
  message's JSON object, validates, retries once into the same session on
  mismatch, then fails the step loudly. Declared keys become named step
  outputs (typed tokens) alongside `result`/`chat_id`. Empty/absent
  `expects` = today's behavior.
- **A3 — `is_one_of` comparator** (enables "⟨scope⟩ is one of xs, s" gates).

## 7. Execution order & deletion ownership

- **Node Phase 0 first** (types + fixtures) — unblocks both other plans' type
  imports. Then in parallel: Node P1–P8 ⟂ UI P0–P5 (fixtures-first). UI P6
  (live wiring + entry swap) requires Node routes (P7) live.
- **v1 UI + e2e deletion is owned by the UI plan** (its Phase 7):
  `packages/ui/src/features/workflows/`, `packages/ui/src/lib/api/workflows.ts`,
  the AppShell/SidebarHeader edits, `packages/e2e/tests-tauri/workflows.spec.ts`,
  and the sidebar-chrome spec assertions — they break at the UI entry swap, so
  their removal rides that plan's timing. Node Task 29 keeps only the
  `packages/types` workflow type/event deletions (Task 28 keeps core).
- Node P9 runs **after** the UI plan's Phase 6 swap — the app never ships
  without a workflows screen.
- The Rust plan is independent throughout; its conformance suite re-runs after
  any fixture change.

## 8. Conformance fixtures

Canonical six §12 reference automations live as JSON at
`packages/types/fixtures/automations/*.json` (not compiled into the
package build). Node tests import them; Rust tests load them by relative
path. The Rust plan's `packages/daemon-rs/fixtures/` and the Node plan's
inline `fixtures.ts` both re-point here. Fixtures are the tie-breaker for
any wire-shape dispute; they must exercise A1–A3.
