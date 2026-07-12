# Automations v2 — Ratified Cross-Plan Contract

Single source of truth for every wire shape shared by the three v2 plans
(`2026-07-12-automations-v2-node-refactor.md`, `…-rust-engine.md`, `…-ui.md`).
Where a plan disagrees with this document, this document wins. Ratified
2026-07-12, then hardened after a dual review (thermo-nuclear + Codex) that
found reconciliation residue in the physical wire surface. Field names, output
tables, and the checkpoint shape below are now **exact** — a plan that spells a
field differently is wrong, not a synonym.

## 1. Type model (`@qlan-ro/mainframe-types` — Node Task 1 emits these types)

Field names are the wire (JSON, camelCase on both arms — Rust uses
`#[serde(rename_all="camelCase")]`; Rust *identifier* casing is free but the
serialized name must match this list):

- Step kinds: `ask_agent | ask_me | run_action | notify | if | repeat`.
- Step base fields: `id: string` (non-empty, unique within a definition; NOT a
  UUID type — an opaque string), `keepGoing?: boolean` (default false). The
  UI's internal `continueOnError` name is **renamed to `keepGoing`** — one wire
  name only.
- `TokenRef = {stepId, output, field?}` — flat, no tagged kinds. Reserved
  stepIds: `trigger`, `builtin` (outputs `today`, `now`), `current`. `output`
  is the producing step's named output (see §5); `field` is a dot-path string
  into a structured output.
- `ChipPart = string | {token: TokenRef}`; `ChipText = ChipPart[]`. **Flat
  union — NOT a tagged `Segment::Text{text}|Token{token}`.** Rust models it as
  an untagged enum serializing to exactly this shape.
- `RunActionStep.params: Record<string, ChipText>` — every param value is a
  ChipText. **No `ParamValue = Template | Json` variant.** A param needing a
  raw non-string value is still authored as ChipText and coerced at execution.
- Ask-me field visibility: `showWhen?: {key, equals}` (one wire name; Rust's
  `when` is renamed).
- Repeat: `{kind:'repeat', items: TokenRef, steps: [...]}` — the list token
  field is `items` (Rust's `over` is renamed).
- Comparators: `is | is_not | contains | starts_with | eq | lt | gt |
  is_empty | not_empty | is_one_of` (A3). `contains` is polymorphic (substring
  on text, membership on list). `is_one_of` takes an array value.
- Schedule trigger: `{schedule: SchedulePattern, onMissed: 'run_once'|'skip'}`
  (Rust's `missedRun`/`catch_up_once` renamed). `SchedulePattern` includes
  `every_n_hours` but the picker offers **only divisors of 24** (`0 */n * * *`
  is wrong for non-divisors — see §9). All schedules run in local time.
- Event trigger union: `session.finished | automation.finished |
  automation.failed`. GitHub PR opened/merged are **webhook presets** (§4), not
  events — Rust's EventSource carries app events only.
- Run statuses: `running | waiting | succeeded | failed | cancelled`.
  Interaction statuses: `pending | answered | cancelled`.

## 2. Checkpoint JSON (`automation_runs.checkpoint` column) — canonical shape

```
{
  definition: AutomationDefinition,   // FROZEN snapshot at run start (see below)
  trigger: { kind, triggerId?, scheduledFor?, payload? },  // firing context + tokens
  steps: Record<stepRef, {
    stepId, kind,
    status: 'running'|'succeeded'|'failed'|'waiting'|'skipped',
    outputs: Record<string, unknown> | null,   // keyed by output name (§5)
    error, startedAt, finishedAt, chatId?, interactionId?
  }>,
  wakeAt: number | null,
  error: string | null
}
```

- **Definition snapshot is mandatory and lives here** (there is no column for
  it; Decision "no extra `automation_runs` columns" stands). Both engines'
  `advance()` re-walk `checkpoint.definition`, **never the live `automations`
  row** — editing an automation mid-run must not shift stepRefs or branch
  shapes under an in-flight run.
- **`running` is a real persisted status** (pre-effect marker). Before
  executing any non-idempotent action (`run_command`, connectors, `http`,
  `ask_agent` side effects), the engine commits the step `running`; on
  restart, a `running` entry is NOT re-executed silently — it resolves per the
  restart-mid-action policy (idempotent → re-run; else → fail
  "engine restarted mid-action; effect unknown", `keepGoing` decides). Replay
  skips `succeeded|skipped`; `running`/`waiting`/`failed` follow their policies.
- `stepRef` = `<stepId>` top-level/If-branch, `<stepId>#<iteration>` inside
  Repeat (suffixes chained for nesting).
- Per-step outputs cap 4 MB (loud "write large data to a file" failure).
  **Aggregate guard:** a Repeat whose list exceeds `MAX_REPEAT_ITEMS` (default
  500) fails loudly before iterating — the single-JSON checkpoint rewrites the
  whole doc per `advance()`, so unbounded fan-out is O(N²) and must be capped,
  not discovered in production.

## 3. Storage

- Contract tables (3): `automations`, `automation_runs`,
  `automation_interactions`. DB file `<dataDir>/automations.db` (a **separate
  file** from `mainframe.db` — keeps it out of the migration lock-step),
  WAL, busy_timeout 5000. Exactly ONE engine owns the file at a time
  (`MAINFRAME_DAEMON_IMPL` selects Node xor Rust); the canary never runs both
  automations engines against it concurrently (see §9).
- **Trigger dedup is a DB uniqueness invariant, not check-then-create.**
  `automation_runs` carries a unique index on
  `(automation_id, trigger_dedup_key)` where `trigger_dedup_key` is a generated/
  stored column = `<triggerId>|<scheduledFor>` (empty for manual). A duplicate
  fire loses the insert race deterministically instead of double-scheduling.
- **Interaction resolution is one transaction.** Claiming an interaction
  (`pending→answered`) and writing its answers into the run checkpoint commit
  in a single DB transaction; a crash cannot strand an `answered` interaction
  against a `waiting` step. Same for run-cancel cancelling pending interactions.
- Node's `trigger_state` / `agent_waits` are engine-internal rebuildable
  caches, NOT contract; Rust keeps its derived-state design. Both engines
  ignore unknown tables in the file.
- Credentials: `<dataDir>/automation-credentials.json`, 0600 plaintext JSON —
  threat model is **cross-user read protection only** (§9); webhook signing
  secrets under reserved labels `webhook:<hookId>`.

## 4. REST + WS

- Full route list (WS4 envelope `{success, data|error}`; every body zod-
  validated on Node, serde on Rust):
  `GET/POST /api/automations`, `GET/PUT/DELETE /api/automations/:id`,
  `POST /api/automations/:id/runs`, `GET /api/automations/:id/runs`,
  `GET /api/automation-runs/:id`, `POST /api/automation-runs/:id/cancel`,
  `GET /api/automation-interactions`,
  `POST /api/automation-interactions/:id/respond`,
  `GET /api/automation-actions`, `GET /api/automation-credentials`,
  `GET/PUT/DELETE /api/automation-credentials/:label`,
  `POST /api/automation-webhooks/:hookId`.
- **Webhook ingress** (`POST /api/automation-webhooks/:hookId`, auth-exempt by
  path): HMAC-SHA256, timing-safe compare. Signature encoding is fixed as
  `sha256=<lowercase-hex>` (GitHub's `X-Hub-Signature-256` form); accept header
  `X-Signature` or `X-Hub-Signature-256`. **Replay defense:** dedup on the
  delivery id (`X-GitHub-Delivery` or a required `id` field) via the §3 unique
  index; stale deliveries beyond a window are dropped.
- **Webhook presets carry a server-side match predicate**, evaluated after
  signature verification, before starting a run: e.g. PR-opened =
  `{event:'pull_request', action:'opened'}`, PR-merged =
  `{event:'pull_request', action:'closed', merged:true}`. Without it a
  `pull_request` delivery fires on every label/sync edit. The preset stores its
  predicate; a non-match returns 204 and starts no run.
- WS events (5): `automation.run.updated {run}`,
  `automation.interaction.created {interaction}`,
  `automation.interaction.resolved {interactionId, runId}`,
  `automation.completed {automationId, automationName, runId,
  status:'succeeded'|'failed', result}` (serves both chaining triggers — note
  the *event* is `automation.completed`; the trigger selectors
  `automation.finished`/`automation.failed` filter it by status, they are NOT
  separate WS events), `automation.notification {runId, automationId, title,
  body, links:{runId, chatIds}}`. All five are chatId-less and ride each WS
  arm's no-chatId broadcast path.
- Timeline entry previews truncate at 32 KB.

## 5. Actions — authoritative id + output table

| id | outputs (name: type) |
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
| `ask_agent` (verb) | `result: text`, `chatId: text`, + A2 `expects` keys |

- Output-name casing is camelCase on the wire (`exitCode`, `prUrl`, `prNumber`,
  `pageUrl`, `workItemId`). No engine adds outputs beyond this table (Rust drops
  its extra `http.request → result`; `files.read` is `content` only).
- Output **type** enum is exactly `text | number | list | record` (Rust drops
  `none`; a no-output action has an empty outputs map).
- `run_command` shell: `zsh -lc` array-args on macOS (`sh -lc` fallback). See A1.

## 6. Amendments (spec updated; each daemon plan carries a task)

- **A1 — env-var injection for `run_command`.** Script chips are never spliced
  into shell source: each becomes `MF_<n>` in the child env and the script text
  gets a quoted `"$MF_<n>"` where the chip sat; only author-typed literal text
  is shell source. **`cwd`/run-in is NOT env-substituted** — spawn `cwd` is not
  shell source. Run-in is an enum (`project root | worktree | custom`); a
  `custom` path built from chips is resolved to a string and passed through
  `resolveAndValidatePath()` containment before spawn (repo path-validation
  rule). The "what will run" preview must detect a chip inside single-quotes or
  a quoted heredoc (where `$MF_<n>` will NOT expand) and surface a
  plain-language warning instead of a misleading resolved preview.
- **A2 — structured agent outputs.** `ask_agent` gains
  `expects?: Array<{key, type:'text'|'number'|'list'|'choice', options?}>`.
  Engine appends the output contract to the session, parses the final message's
  JSON object, validates, retries once into the same session on mismatch, then
  fails the step loudly. Declared keys become named outputs (typed tokens)
  alongside `result`/`chatId`. Absent `expects` = today's behavior.
- **A3 — `is_one_of` comparator.**

## 7. Execution order & deletion ownership

- **Node Phase 0 first** (shared types + the §8 fixtures) — unblocks both other
  plans. Then in parallel: Node P1–P8 ⟂ UI P0–P5 (fixtures-first) ⟂ Rust P1–P11.
- **Rust is independent EXCEPT its fixture-consuming tasks** (T1.2 load +
  conformance) depend on Node Phase 0's fixtures. Rust authors no fixtures.
- UI P6 (live wiring + entry swap) requires Node routes live. UI P7 deletes the
  v1 UI tree.
- **Deletion ownership:** UI Phase 7 owns `packages/ui/src/features/workflows/`,
  `lib/api/workflows.ts`, the AppShell/SidebarHeader edits, and the e2e
  workflows spec + sidebar-chrome assertions. Node Task 28 deletes core
  workflows + routes. **Node Task 29 (deletes `packages/types/src/workflow.ts`
  + `workflow.*` events) runs AFTER UI Phase 7** — the v1 UI still imports those
  types, so removing them before UI P7 fails `ui typecheck`. (Contract earlier
  said "after Phase 6"; corrected to Phase 7.)
- Sequenced tail: UI P6 swap → UI P7 v1-UI deletion → Node Task 28 → Node Task
  29. The app never ships without a workflows screen.

## 8. Conformance fixtures

- Canonical location, **single author = Node Phase 0**, exact filenames (Rust
  and UI *load* these, never author them):

  | # | file | §12 automation |
  |---|---|---|
  | 1 | `packages/types/fixtures/automations/daily-health-log.json` | health log |
  | 2 | `packages/types/fixtures/automations/daily-standup.json` | standup |
  | 3 | `packages/types/fixtures/automations/pr-auto-review.json` | PR auto-review |
  | 4 | `packages/types/fixtures/automations/morning-pr-sweep.json` | PR sweep |
  | 5 | `packages/types/fixtures/automations/ship-work.json` | ship work |
  | 6 | `packages/types/fixtures/automations/daily-feature-spike.json` | feature spike |

- **Fixtures AUGMENT §12, they are not byte-faithful.** §12's automations don't
  all exercise A1–A3, so: fixture 6 (`daily-feature-spike`) carries the A1
  `run_command` step, the A2 `expects:[{key:'scope',type:'choice',
  options:['xs','s','m']}]`, and an `is_one_of` (A3) gate. All three plans use
  the SAME augmented fixture — no plan re-augments a different one.
- Fixtures are the tie-breaker for any wire dispute; both daemon conformance
  suites and the UI fixtures re-point here (`packages/daemon-rs/fixtures/` and
  Node's inline `fixtures.ts` become thin loaders).

## 9. Known deferrals & open decisions (not silently scoped out)

- **MCP launch scope (DECIDED 2026-07-12: defer to post-launch).** None of the
  six reference automations uses an MCP action. Ratified scope: keep the
  action-registry seam and the `ActionCatalogEntry` shape in all plans, but
  **live MCP discovery/client/invocation is a post-launch phase, on the
  cutover-default engine (Node) only, behind `AUTOMATIONS_MCP_ENABLED`
  (default off)**. The launch action catalog returns no `mcp:*` entries until
  the flag is enabled. Rust ships only the registry/catalog seam — no live MCP
  crate at launch. The config-source and trust-boundary gaps below are prereqs
  for enabling the flag, not launch blockers.
- **MCP trust boundary.** MCP servers sourced from a project's `.mcp.json` let a
  malicious repo choose a subprocess the daemon spawns — same category as the
  open `docs/security/` criticals. Any live-MCP task requires a negative test
  and an explicit allowlist/confirmation gate.
- **Webhook auth-exemption** is by-path; it must not regress the WS
  `X-Forwarded-For` finding — requires a negative test asserting other routes
  still 401.
- **Ask-agent auto-approve scope / budget cap** have no `ChatManager` parameter
  today (Rust R6; Node unconfirmed). Feature-spike is **authorable but not
  executable** until that lands; conformance must assert against a NON-fake
  AgentPort so a green suite can't hide the gap. Landing the `ChatManager`
  parameter is a prerequisite task on whichever engine is cutover-default.
- **Under-built product surfaces** (tracked, intentional for v1): Describe-it
  ships behind `DESCRIBE_ENABLED=false` (no drafting endpoint); webhook sample
  capture unrouted to the editor; Notion column-picker needs a schema-lookup
  endpoint the contract lacks (until then `notion.add_row` takes explicit
  key/values); mobile hours-later answering needs the out-of-scope mobile UI.
- **Line-number anchors** in the Node/Rust plans are approximate — locate edit
  sites by symbol, not absolute line.
- **User-facing label** stays "Workflows" while code/routes/testids say
  `automations` (intentional; avoids a rename churn).
