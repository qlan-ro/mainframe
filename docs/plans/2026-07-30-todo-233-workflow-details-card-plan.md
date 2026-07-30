# Implementation plan — Claude Code workflow run details

Todo #233 · route:full · branch `todo/233-workflow-details-card`
Spec: `docs/specs/2026-07-30-todo-233-workflow-details-card.md` (30 acceptance criteria, decisions D1–D20)
Design gate: the `## Design direction` (2026-07-29) block in the todo body — authoritative for tokens, insets and class recipes.

## Goal

When the Claude CLI runs one of its own workflow scripts it publishes the entire run — the seeded
phase list, every agent's identity, state, tokens, tool calls and errors — on `task_progress` system
events that the Rust daemon currently drops into a catch-all arm, and it writes a full run record to
disk when the run completes. This work makes the daemon ingest both, hold them in a new per-chat
workflow-run store, broadcast every change, and hand the accumulated runs back on the async per-chat
history response so a webview reload or a later daemon process reconstructs the same view. On the UI
it adds one popover panel reachable from two places — a permanent one-line launcher row that every
`Workflow` / `RunWorkflow` tool call renders as, and a clickable row inside the existing
background-activity popover while the run is live — showing the phase/agent breakdown, run-cumulative
tokens and duration, and honest neutral rows for outcomes nobody observed. It also fixes the
`task_updated` ingest defect (the daemon reads a top-level `status` the CLI never sends; the value
lives under `patch.status`) so paused and killed runs become observable at all.

## Constraints that bind this plan

From the root `CLAUDE.md`, `packages/ui/CLAUDE.md`, and spec AC 26–30:

- **Max 300 lines per file, 50 per function.** Several files this work touches are already over:
  `task_events.rs` (630), `events.rs` adapter (1454), `history.rs` (417), `session.rs` (1749),
  `chat_deps.rs` (1582), `event_handler.rs` (2021), `chats.rs` routes (757), `main.rs` daemon (895),
  `mainframe-types/src/events.rs` (857), `chat-thread-state.ts` (518), `user_event.rs` (512).
  **Rule for this plan:** every edit to an already-over-limit file is *dispatch only* — a struct
  field, an enum variant, or a single delegating call into a new sibling module. Each such task below
  states its own line budget. No new logic lands in those files.
- **`data-testid` on every interactive element**, `<surface>-<element>` kebab-case, keyed by domain id.
  The gate fixes six: `chat-workflow-launcher-<runId>`, `chat-workflow-panel-<runId>`,
  `chat-workflow-phase-<index>`, `chat-workflow-agent-<agentId>`,
  `chat-background-workflow-<runId>`, and `chat-workflow-back-<runId>`. `<index>` here is the CLI's
  own `workflow_phase.index` from the snapshot — a domain id, not an array position. Say so in the
  code.
- **No sync I/O in the daemon.** The disk read runs on the async history path only (D9).
- **No silent catches.** Every `catch`/`Err` arm logs through `tracing` in Rust.
- **Single canonical type** — every wire shape is defined once in `mainframe-types` (Rust) and
  `packages/types` (TS); the daemon contract is co-owned with the mobile submodule, so all additions
  are optional/additive and mobile ignores them.
- **Changeset required** before the branch can be pushed.
- **Never commit to `main`.** All work stays on `todo/233-workflow-details-card`.
- **Disk hygiene.** `cargo` in this worktree grows `packages/core-rs/target/` from cold. Do not set
  `CARGO_TARGET_DIR`. Prefer `cargo test -p <crate>` over whole-workspace runs.

### AC 26 (Zod on every endpoint / WS message) — scope note, read before reviewing

This work adds **no new HTTP route and no new client→server WS message**. It adds (a) one additive
field on an existing REST response (`ChatHistoryPayload.workflowRuns`) and (b) one new
**server→client** broadcast (`claude_workflow.run.updated`). Neither carries client-supplied input,
and no sibling daemon event in this codebase is Zod-validated on the client — `packages/types/src/events.ts`
is a plain discriminated union. Adding an unused Zod schema would be dead code, which the "no leftovers"
rule forbids. AC 26 is therefore satisfied vacuously; the substituted coverage is Task 11 (an
integration test on the extended `GET /api/chats/{id}/messages` response) plus Task 30 (a client-side
test that the new event reduces correctly).

## Verified facts this plan is built on

Re-verified against the worktree while planning; cite these when reviewing.

1. `handle_system_event` (`packages/core-rs/crates/mainframe-adapter-claude/src/events.rs:90`) has
   arms for `init`, `compact_boundary`, `task_started`, `task_updated`, `task_notification`,
   `status`, and `_ => {}` at line 218 — `task_progress` is discarded there.
2. The `task_updated` arm (`events.rs:169`) reads `event.get("status")`; the CLI puts it at
   `patch.status`. No `task_updated` of any status currently reaches the daemon.
3. `map_status` (`task_events.rs:92`) has only `completed | failed | stopped` arms and defaults
   everything else to `Stopped` with a warning; its caller is `tracker.end()`.
4. **`task_progress` does not carry a run id.** Its fields are `task_id`, `tool_use_id`,
   `description`, `subagent_type`, `usage`, `last_tool_name`, `summary`, and sometimes
   `workflow_progress` (todo constraint 3). The run id lives only on the `Workflow` tool result
   (`status: "async_launched"`, `taskId`, `taskType`, `workflowName`, `runId`, …; constraint 6) and
   in the on-disk record. **The store's canonical key is therefore `task_id`; `run_id` is an
   attribute learned from the tool result or the record.**
5. The completed-run record is `<claude project dir>/<sessionId>/workflows/wf_<runId>.json`; its
   `workflowProgress` has the same shape as the streamed snapshot (constraint 7). An interrupted run
   writes no record at all (constraint 8).
6. `BackgroundTaskTracker` lives in its own crate (`mainframe-background-tasks`), is constructed in
   `mainframe-daemon/src/main.rs:196`, injected into `ClaudeAdapter::new` at :198, and fanned onto the
   daemon bus by `spawn_task_event_bridge` (`main.rs:506`). This is the precedent the new store follows.
7. The WS fan-out (`mainframe-server/src/websocket.rs:662`) routes any event carrying a `chatId` to
   that chat's subscribers automatically — a new `chat_id`-bearing variant needs no routing work.
8. **Naming collisions to avoid:** `workflow.run.updated` / `WorkflowRunSummary` (`mainframe-types/src/events.rs:363`)
   and `mainframe-types/src/workflow.rs` belong to the **Automations** feature; `mainframe-types/src/task_progress.rs`
   is the **V2 TaskCreate/TaskUpdate** helper, unrelated to the CLI's `task_progress` event. New names
   must be `claude_workflow*` / `ClaudeWorkflow*` / `claude_workflow.run.updated`.
9. `ChatManager::get_display_messages` (`mainframe-chat/src/chat_manager.rs:1574`) is async and
   lock-free; the route is `mainframe-server/src/routes/chats.rs:143`, registered at :477.
   `prepare_messages_for_client` is sync under two mutexes — nothing goes there.
10. The CLI-exit sweep is `self.deps.tracker_end_all_running(&self.chat_id)` at
    `mainframe-chat/src/event_handler.rs:1012`. The `EventHandlerDeps` trait declares it at :98,
    `ChatManagerDeps` at `chat_manager.rs:269`, and there are **five** test doubles to update:
    `event_handler.rs:1348`, `event_handler.rs:1866`, `event_handler/worktree_trigger_tests.rs:78`,
    `event_handler/permission_cancel_tests.rs:45`, `chat_manager/tests.rs:313`.
11. `packages/core-rs/Cargo.toml` uses `members = ["crates/*"]`, so a new crate dir is picked up
    automatically, but it still needs a `[workspace.dependencies]` path entry (see :55–66).
12. `mainframe-server/tests/chat_background_activity.rs` is the precedent for the new history test.
13. The prototype (`packages/ui/src/features/chat/workflow-details-PROTOTYPE/`, commit `2610ca7b` on
    `proto/233-workflow-details-view`) is throwaway code but its class recipes are the design contract.
    Copy the recipes, not the files; delete nothing there (it is on a different branch).

## Architecture decisions taken while planning

Flag these to the user — they are mine, not the spec's.

- **A1 — The workflow-run store is keyed by `task_id`, with `run_id` as a learned attribute.** Forced
  by verified fact 4. Consequences: the daemon learns `run_id` by scanning the `Workflow` tool result
  (Task 19), the UI looks state up by `taskId` (which its tool result also carries), and the four
  gate-mandated testids still use `runId` because the launcher row always has it from the tool result.
- **A2 — The store lives in a new crate, `mainframe-claude-workflows`.** It must be shared by
  `mainframe-adapter-claude` (writer), `mainframe-server` (REST read + `AppCtx`) and the daemon binary
  (bridge). A new crate mirrors `mainframe-background-tasks` exactly and keeps the dependency graph
  acyclic. It depends only on `mainframe-types`, `tokio`, `serde_json`, `dashmap`, `chrono`, `tracing`.
- **A3 — The daemon-bus bridge (`spawn_workflow_run_bridge`) lives in the new crate, not in
  `main.rs`.** `main.rs` is already 895 lines; the precedent bridge sits there, but adding a second
  one would grow an over-limit file with new logic. `main.rs` gets six lines.
- **A4 — The disk backfill is composed in a new route-sibling module
  (`mainframe-server/src/routes/chat_workflow_runs.rs`), not plumbed through `ChatManagerDeps`.** The
  route handler already holds `AppCtx`, which owns both the store and the `db` needed to resolve the
  chat's Claude session id and effective cwd. Plumbing it through the deps trait would mean six more
  test-double updates for no gain.
- **A5 — The record scan is scoped to the chat's *current* `claude_session_id`.** Records live under
  the session that ran them; a chat resumed under a new session id will not backfill runs from an
  earlier session id. This is the honest bound: those runs fall through to the spec's
  **Run details unavailable** state (D15 / AC 19), which is the designed fallback. **Open risk — see
  the report.**
- **A6 — Presentation derivation (stale neutralization, dot tone, meta string, status chip label)
  lives in pure `.ts` modules under `packages/ui/src/features/chat/workflow/`, not in the daemon.**
  The daemon reports observed state; what a 10-second-stale row *looks like* is presentation, and the
  mobile client renders it differently. This follows the existing `features/chat/view-model/` pattern
  and does not violate the "pure logic lives in core" rule, which targets parsing and status
  derivation from the wire — both of which do stay in Rust.
- **A7 — `totalToolCalls` is not put on the wire.** The disk record carries it, but the spec's *Not
  Included* declines a run-level tool-call readout, and an unrendered field is dead code. Per-agent
  `toolCalls` does ship (it is in the agent row's hover title, D19).
- **A8 — Red-phase Rust tests are crate integration tests (`tests/*.rs`), not inline `mod tests`.**
  Inline tests would put the test group and the implementation group in the same file. The test group
  also lays down the new crate's skeleton with `unimplemented!()` bodies so the red phase is a
  failing assertion rather than a compile error.

## Files touched

**New**

| Path | Owner group |
|---|---|
| `packages/core-rs/crates/mainframe-types/src/claude_workflow.rs` | contract |
| `packages/types/src/claude-workflow.ts` | contract |
| `.changeset/todo-233-claude-workflow-details.md` | contract |
| `packages/core-rs/crates/mainframe-claude-workflows/Cargo.toml` | rust-tests (skeleton) → wf-core |
| `packages/core-rs/crates/mainframe-claude-workflows/src/{lib,store,snapshot,status,record,merge,bridge,reconcile}.rs` | rust-tests (stubs) → wf-core |
| `packages/core-rs/crates/mainframe-claude-workflows/tests/{snapshot_parse,status_mapping,run_record,merge_precedence,store_lifecycle}.rs` | rust-tests |
| `packages/core-rs/crates/mainframe-claude-workflows/tests/fixtures/*.json` | rust-tests |
| `packages/core-rs/crates/mainframe-adapter-claude/tests/workflow_task_events.rs` | rust-tests |
| `packages/core-rs/crates/mainframe-server/tests/workflow_runs_history.rs` | rust-tests |
| `packages/core-rs/crates/mainframe-adapter-claude/src/workflow_events.rs` | wf-adapter |
| `packages/core-rs/crates/mainframe-server/src/routes/chat_workflow_runs.rs` | wf-daemon |
| `packages/ui/src/features/chat/controller/chat-workflow-runs.ts` | ui-state |
| `packages/ui/src/features/chat/workflow/workflow-progress.ts` | ui-view |
| `packages/ui/src/features/chat/workflow/workflow-agent-view.ts` | ui-view |
| `packages/ui/src/features/chat/workflow/use-workflow-run.ts` | ui-view |
| `packages/ui/src/features/chat/workflow/WorkflowRunPanel.tsx` | ui-view |
| `packages/ui/src/features/chat/workflow/WorkflowRunPanelHeader.tsx` | ui-view |
| `packages/ui/src/features/chat/workflow/WorkflowPhaseList.tsx` | ui-view |
| `packages/ui/src/features/chat/workflow/WorkflowAgentRow.tsx` | ui-view |
| `packages/ui/src/features/chat/workflow/WorkflowStaleBanner.tsx` | ui-view |
| `packages/ui/src/features/chat/workflow/WorkflowRunUnavailable.tsx` | ui-view |
| `packages/ui/src/features/chat/workflow/WorkflowLauncherRow.tsx` | ui-view |
| `packages/ui/src/features/chat/composer/WorkflowActivityPopover.tsx` | ui-view |
| `packages/ui/src/features/chat/workflow/__tests__/*.test.{ts,tsx}` | ui-tests |

**Modified** (all dispatch-only where the file is already over 300 lines)

| Path | Owner group |
|---|---|
| `packages/core-rs/crates/mainframe-types/src/{lib,background_task,display,events}.rs` | contract |
| `packages/types/src/{index,background-task,display,events}.ts` | contract |
| `packages/types/src/__tests__/background-activity.test.ts` | contract |
| `packages/core/src/chat/chat-manager.ts` | contract |
| `packages/ui/src/features/sessions/runtime/__tests__/new-thread-create-once.test.tsx` | contract |
| `packages/core-rs/Cargo.toml` | rust-tests |
| `packages/core-rs/crates/mainframe-adapter-claude/{Cargo.toml,src/lib.rs,src/events.rs,src/task_events.rs,src/user_event.rs,src/session.rs,src/adapter.rs}` | wf-adapter |
| `packages/core-rs/crates/mainframe-background-tasks/src/{tracker,reconcile,kill,liveness}.rs` | wf-adapter |
| `packages/core-rs/crates/mainframe-daemon/{Cargo.toml,src/main.rs}` | wf-daemon |
| `packages/core-rs/crates/mainframe-daemon/tests/{boot_routes_integration,health_integration}.rs` | wf-daemon |
| `packages/core-rs/crates/mainframe-server/{Cargo.toml,src/ctx.rs,src/chat_deps.rs}` | wf-daemon |
| `packages/core-rs/crates/mainframe-server/src/routes/{chats,mod,background_tasks,adapters,automations_test_support,quota}.rs` | wf-daemon |
| `packages/core-rs/crates/mainframe-server/tests/support/mod.rs` | wf-daemon |
| `packages/core-rs/crates/mainframe-server/tests/chat_background_activity.rs` | rust-tests |
| `packages/core-rs/crates/mainframe-chat/src/{chat_manager,event_handler}.rs` | wf-daemon |
| `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` | wf-daemon |
| `packages/core-rs/crates/mainframe-chat/src/event_handler/{worktree_trigger_tests,permission_cancel_tests}.rs` | wf-daemon |
| `packages/ui/src/features/chat/controller/{chat-thread-state,handle-daemon-event,chat-thread-controller}.ts` | ui-state |
| `packages/ui/src/features/chat/controller/__tests__/handle-daemon-event-background.test.ts` | contract |
| `packages/ui/src/features/chat/controller/__tests__/chat-thread-state-background.test.ts` | ui-tests |
| `packages/ui/src/features/chat/composer/BackgroundActivityBar.tsx` | ui-view |
| `packages/ui/src/features/chat/tools/register-cards.ts` | ui-view |
| `packages/ui/src/features/chat/composer/__tests__/BackgroundActivityBar.test.tsx` | ui-tests |

## The wire contract (write it exactly once, here)

Every group below codes against this. Rust in `mainframe-types/src/claude_workflow.rs`, all structs
`#[serde(rename_all = "camelCase")]`, all enums `#[serde(rename_all = "camelCase")]`, all
`Option` fields `#[serde(skip_serializing_if = "Option::is_none")]`.

```rust
pub enum ClaudeWorkflowRunStatus { Running, Completed, Failed, Stopped, Paused, Unavailable }
pub enum ClaudeWorkflowAgentState { Start, Progress, Done, Error, Unknown }
pub enum ClaudeWorkflowRunSource { Launch, Snapshot, Record }

pub struct ClaudeWorkflowPhase { pub index: i64, pub title: String, pub kind: Option<String> }

pub struct ClaudeWorkflowAgent {
    pub agent_id: String,
    pub index: i64,
    pub phase_index: i64,
    pub label: String,
    pub state: ClaudeWorkflowAgentState,
    pub model: Option<String>,
    pub attempt: Option<i64>,
    pub tokens: i64,
    pub tool_calls: i64,
    pub duration_ms: i64,
    pub error: Option<String>,
    pub result_preview: Option<String>,
    pub last_tool_name: Option<String>,
    pub last_tool_summary: Option<String>,
    pub last_progress_at: Option<i64>,   // ms epoch
}

pub struct ClaudeWorkflowRun {
    pub task_id: String,                 // canonical key (A1)
    pub run_id: Option<String>,
    pub workflow_name: Option<String>,
    pub status: ClaudeWorkflowRunStatus,
    pub source: ClaudeWorkflowRunSource,
    pub total_tokens: i64,
    pub duration_ms: i64,
    pub structure_revision: Option<i64>, // usage.duration_ms of the last accepted snapshot
    pub terminal_at: Option<i64>,         // ms epoch the run went terminal
    pub phases: Vec<ClaudeWorkflowPhase>,
    pub agents: Vec<ClaudeWorkflowAgent>,
}
```

Additive wire changes:

- `BackgroundActivityTask` (`mainframe-types/src/background_task.rs`, `packages/types/src/background-task.ts`)
  gains `workflow_name: Option<String>` / `workflowName?: string` and `run_id: Option<String>` /
  `runId?: string`. **No status field** (D12).
- `BackgroundTask` (same modules) gains the same two optional fields so `to_activity_task` /
  `toActivityTask` can carry them through.
- `ChatHistoryPayload` (`mainframe-types/src/display.rs:151`, `packages/types/src/display.ts:76`)
  gains `workflow_runs: Vec<ClaudeWorkflowRun>` / `workflowRuns: ClaudeWorkflowRun[]` (defaults to
  empty, `#[serde(default)]`).
- `DaemonEvent` gains `#[serde(rename = "claude_workflow.run.updated")] ClaudeWorkflowRunUpdated { chat_id: String, run: ClaudeWorkflowRun }`
  and the TS union gains `| { type: 'claude_workflow.run.updated'; chatId: string; run: ClaudeWorkflowRun }`.

### Structural freshness signal

The CLI event has no event sequence or top-level timestamp, so arrival time is not a valid freshness
signal. Use the event's run-cumulative `usage.duration_ms` as `structure_revision` **only when that
event carries `workflow_progress`**. Verified fact 4 establishes that this value is wall-clock elapsed
run time, so an older emitted snapshot has a smaller revision even when an unchanged agent happens to
carry the newest `lastProgressAt` in both arrays. The store accepts a snapshot when its revision is
greater than or equal to the retained revision. A `task_progress` event with no `workflow_progress`
may advance displayed cumulative totals but never changes `structure_revision`. Totals themselves use
`max(current, incoming)` so a delayed event cannot make them run backwards. A disk record with a
snapshot sets its revision from record `durationMs`; terminal records still win by source precedence,
regardless of revision.

## The store contract (crate `mainframe-claude-workflows`)

```rust
// store.rs
pub struct RunEvent { pub chat_id: String, pub run: ClaudeWorkflowRun }
pub struct ProgressUsage { pub total_tokens: i64, pub duration_ms: i64 }

pub struct ClaudeWorkflowStore { /* DashMap<String, HashMap<String, ClaudeWorkflowRun>> + broadcast::Sender<RunEvent> */ }

impl ClaudeWorkflowStore {
    pub fn new() -> Self;
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<RunEvent>;
    /// `task_started` with a workflow task_type. Idempotent.
    pub fn seed(&self, chat_id: &str, task_id: &str, workflow_name: Option<String>);
    /// Learned from the `Workflow` tool result. Idempotent; never downgrades a known run_id.
    pub fn link_run_id(&self, chat_id: &str, task_id: &str, run_id: &str, workflow_name: Option<String>);
    /// `task_progress`. `snapshot: None` updates totals only and never clears structure (AC 12).
    pub fn apply_progress(&self, chat_id: &str, task_id: &str, usage: ProgressUsage, snapshot: Option<&[Value]>);
    /// Terminal or paused stamp. Idempotent: a second terminal signal does not restart duration (AC edge).
    pub fn stamp_status(&self, chat_id: &str, task_id: &str, status: ClaudeWorkflowRunStatus);
    /// Terminal reconciliation result (D7) and disk backfill (D9) both land here.
    pub fn apply_record(&self, chat_id: &str, run: ClaudeWorkflowRun);
    /// D5 — the CLI-exit sweep's workflow counterpart.
    pub fn stop_all_running(&self, chat_id: &str);
    pub fn runs_for_chat(&self, chat_id: &str) -> Vec<ClaudeWorkflowRun>;
    pub fn remove_chat(&self, chat_id: &str);
}

// snapshot.rs
pub struct ParsedSnapshot {
    pub phases: Vec<ClaudeWorkflowPhase>,
    pub agents: Vec<ClaudeWorkflowAgent>,
}
pub fn parse_snapshot(entries: &[Value]) -> ParsedSnapshot;

// status.rs
pub enum TaskUpdateAction { Ignore, End(BackgroundTaskStatus) }
pub fn task_update_action(status: &str) -> TaskUpdateAction;
pub fn terminal_task_status(status: &str) -> BackgroundTaskStatus;
pub fn run_status(status: &str) -> Option<ClaudeWorkflowRunStatus>;

// record.rs
pub fn workflows_dir(project_dir: &Path, session_id: &str) -> PathBuf;
pub fn parse_run_record(value: &Value) -> Option<ClaudeWorkflowRun>;
pub async fn read_run_records(project_dir: &Path, session_id: &str) -> Vec<ClaudeWorkflowRun>;

// merge.rs
pub fn merge_runs(memory: Vec<ClaudeWorkflowRun>, records: Vec<ClaudeWorkflowRun>) -> Vec<ClaudeWorkflowRun>;

// reconcile.rs
pub struct RecordLocation { pub project_dir: PathBuf, pub session_id: String }
pub fn spawn_terminal_reconcile(store: Arc<ClaudeWorkflowStore>, chat_id: String, task_id: String, loc: RecordLocation);

// bridge.rs
pub fn spawn_workflow_run_bridge(store: Arc<ClaudeWorkflowStore>, bus: broadcast::Sender<DaemonEvent>);
```

Status mapping tables, fixed here so three groups agree:

| CLI `patch.status` | `task_update_action` | `run_status` |
|---|---|---|
| `pending` | `Ignore` | `Running` |
| `running` | `Ignore` | `Running` |
| `completed` | `End(Completed)` | `Completed` |
| `failed` | `End(Failed)` | `Failed` |
| `killed` | `End(Stopped)` — **no warning** | `Stopped` |
| `paused` | `End(Stopped)` (D6) | `Paused` |
| `stopped` | `End(Stopped)` | `Stopped` |
| anything else | `End(Stopped)` + `tracing::warn!` | `None` (run untouched) |

`terminal_task_status` is the `task_notification` path: same table, but `Ignore` collapses to
`Stopped` (a notification is terminal by definition).

Merge precedence (`merge_runs`, D8) uses a pairwise identity predicate, not a per-run fallback key:
`same_run(a, b)` compares `run_id` when both sides have one; otherwise it compares `task_id`. Fold
memory and records into one vector, find an incumbent with `same_run`, and apply the rules below. This
makes the asymmetric learned-identity case canonical: memory `{ task_id: T, run_id: None }` and record
`{ task_id: T, run_id: Some(R) }` collapse to one run carrying `R`.

1. A `Record`-sourced run supersedes a `Snapshot`/`Launch` run for the same run.
2. **Except** when the record's `phases` *and* `agents` are both empty and the in-memory run's are
   not — then the in-memory run wins (the empty-snapshot carve-out, inverted), while copying any
   learned `run_id`/`workflow_name` that the winning side lacks.
3. Between two `Snapshot` runs, the larger `structure_revision` wins; equal or absent revisions use
   the later fold candidate so a same-timestamp cumulative snapshot can still replace its predecessor.
4. A run present on only one side passes through unchanged.
5. Output is ordered by `structure_revision.or(terminal_at).unwrap_or(0)` ascending, then `task_id`,
   so the UI list is stable.

---

# Tasks

Each task states its files, its change, and how to verify it. Rust commands run from
`<worktree>/packages/core-rs`; pnpm commands from the worktree root. `<worktree>` =
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-233-workflow-details-card`.

## Group `contract` — shared types (core)

### Task 1 — Rust shared workflow types

**Files:** create `packages/core-rs/crates/mainframe-types/src/claude_workflow.rs`; edit
`packages/core-rs/crates/mainframe-types/src/lib.rs` (+1 line: `pub mod claude_workflow;`, kept in
alphabetical order).

Write the six types from *The wire contract* verbatim. Derive
`Debug, Clone, PartialEq, Serialize, Deserialize` on structs and additionally `Copy, Eq` on the three
enums. Add `impl ClaudeWorkflowRunStatus { pub fn is_terminal(self) -> bool }` returning true for
`Completed | Failed | Stopped | Unavailable` (`Paused` is **not** terminal — its duration is frozen,
but a resume from the CLI's own TUI may still move it). Add
`impl ClaudeWorkflowRun { pub fn new_seed(task_id: &str, workflow_name: Option<String>) -> Self }`
producing `run_id: None`, `status: Running`, `source: Launch`, zeroed totals,
`structure_revision: None`, `terminal_at: None`, and empty vectors.

Do **not** name anything `WorkflowRun*` without the `Claude` prefix (verified fact 8).

**Verify:** `cargo check -p mainframe-types` and `cargo fmt --check` pass. File is under 300 lines
(expected ~150); no function over 50.

### Task 2 — Rust wire additions

**Files:** `mainframe-types/src/background_task.rs` (+~10 lines), `mainframe-types/src/display.rs`
(+3), `mainframe-types/src/events.rs` (+5).

- `BackgroundTask` and `BackgroundActivityTask` each gain
  `#[serde(skip_serializing_if = "Option::is_none")] pub workflow_name: Option<String>` and the same
  for `pub run_id: Option<String>`. Update `to_activity_task` to copy both through. Update every
  struct-literal construction in this file and its `mod tests` to set them to `None`. Tasks 11, 18,
  19, 22, and 23 own every literal outside this crate; none is left implicit.
- `ChatHistoryPayload` gains `#[serde(default)] pub workflow_runs: Vec<ClaudeWorkflowRun>`. Task 25
  owns the existing `ChatManager::get_display_messages` constructor.
- `DaemonEvent` gains the `ClaudeWorkflowRunUpdated` variant from *The wire contract*, placed
  directly after `BackgroundTaskEnded` (line 362) and **before** the Automations `workflow.*` block,
  with a one-line comment naming the collision it avoids.

**Verify:** `cargo test -p mainframe-types` passes (existing tests must compile against the new
fields). `cargo check -p mainframe-background-tasks -p mainframe-chat -p mainframe-server` shows only
struct-literal errors in files owned by later groups — record them in the task's notes, do not fix
them here.

### Task 3 — TypeScript mirror and projection

**Files:** create `packages/types/src/claude-workflow.ts`; edit `packages/types/src/index.ts` (+1
export line), `background-task.ts`, `display.ts`, `events.ts`,
`packages/types/src/__tests__/background-activity.test.ts`,
`packages/core/src/chat/chat-manager.ts`,
`packages/ui/src/features/chat/controller/__tests__/handle-daemon-event-background.test.ts`, and
`packages/ui/src/features/sessions/runtime/__tests__/new-thread-create-once.test.tsx`.

Mirror the Rust types as TS interfaces and string-literal unions using **camelCase** keys exactly as
serde emits them. Keep the `ClaudeWorkflow` prefix. `BackgroundTask` and `BackgroundActivityTask`
gain optional `workflowName` and `runId`; add both `.optional()` fields to
`BackgroundActivityTaskSchema`, and make `toActivityTask` copy both fields so live
`background_task.updated` events do not drop a late link. Extend `background-activity.test.ts` with a
workflow projection assertion that hardcodes both fields and proves the schema accepts them. Extend
`handle-daemon-event-background.test.ts` with a live update that starts unlinked, receives a tracker
update carrying `workflowName`/`runId`, and projects both into the replacement reducer event.

`ChatHistoryPayload.workflowRuns` is `ClaudeWorkflowRun[]` and required in TS. Add `workflowRuns: []`
to the retired TypeScript core's `getDisplayMessages` return and to the typed
`new-thread-create-once.test.tsx` `getChatMessages` mock; these are the only typed producers found by
`rg 'ChatHistoryPayload' packages/core/src packages/ui/src`. Export everything from `index.ts`.

**Verify:** `pnpm build:types && pnpm build:core`; `pnpm --filter @qlan-ro/mainframe-types test`;
`pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit`; and run the two touched UI tests
individually: `handle-daemon-event-background.test.ts` and `new-thread-create-once.test.tsx`.

### Task 4 — Changeset

**Files:** create `.changeset/todo-233-claude-workflow-details.md`.

`minor` for `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui`; `patch` for
`@qlan-ro/mainframe-core` (version-carrier only). One sentence, user-facing, no internal file names:
"Claude Code workflow runs now show their phases, agents and totals in a details panel, reachable
from the transcript and the background-activity popover."

**Verify:** `pnpm changeset status` runs clean; the file parses as valid changeset frontmatter.

## Group `rust-tests` — red-phase Rust tests + crate skeleton (test)

All tests in this group must be **observed failing** before wf-core/wf-adapter/wf-daemon start.
Capture the failing output in the task notes.

### Task 5 — New crate skeleton with unimplemented bodies

**Files:** create `packages/core-rs/crates/mainframe-claude-workflows/Cargo.toml` and
`src/{lib,store,snapshot,status,record,merge,bridge,reconcile}.rs`; edit `packages/core-rs/Cargo.toml`
(+1 line in `[workspace.dependencies]`:
`mainframe-claude-workflows = { path = "crates/mainframe-claude-workflows" }`, placed next to
`mainframe-background-tasks` at :66).

`Cargo.toml` mirrors `mainframe-background-tasks/Cargo.toml`: `edition/version/publish.workspace`,
`[lints] workspace = true`, dependencies `tokio, serde, serde_json, tracing, chrono, dashmap,
thiserror, mainframe-types`, dev-dependencies `tempfile` + `tokio` with `test-util`. Add `indexmap`
to the workspace deps if the store uses it; otherwise use a `HashMap` plus an explicit sort in
`runs_for_chat` (preferred — avoids a new third-party dependency).

Every function from *The store contract* is declared with its exact signature and a body of
`unimplemented!("wf-core")`. `lib.rs` declares and re-exports all seven modules.

**Verify:** `cargo check -p mainframe-claude-workflows` compiles (warnings about unused params are
expected; silence them with `_`-prefixed names, not `#[allow]`). `cargo fmt --check` passes.

### Task 6 — Snapshot-parsing tests (red)

**Files:** create `tests/snapshot_parse.rs` and `tests/fixtures/workflow_progress_snapshot.json` in
`packages/core-rs/crates/mainframe-claude-workflows/`.

Build the fixture from todo constraint 5: a `workflow_phase` entry (`type,index,title,kind`), two
`workflow_agent` entries in different phases (all fields from constraint 5, including
`state: "start"` and `state: "error"` with an `error` string and a `resultPreview`), and one
`workflow_log` entry. Cover, one assertion-focused test each:

1. `workflow_phase` entries become `ClaudeWorkflowPhase` in `index` order.
2. `workflow_agent` entries map every consumed field (`agentId, index, phaseIndex, label, state,
   model, attempt, tokens, toolCalls, durationMs, error, resultPreview, lastToolName,
   lastToolSummary, lastProgressAt`).
3. `workflow_log` entries produce neither a phase nor an agent and do not error (AC 23).
4. An entry with an unknown `type` is ignored; an agent with an unknown `state` maps to
   `ClaudeWorkflowAgentState::Unknown` (spec edge case).
5. An empty entry array yields empty phases and agents without panicking.

**Verify:** `cargo test -p mainframe-claude-workflows --test snapshot_parse` fails with
`unimplemented!("wf-core")` panics, one per test. Record the output.

### Task 7 — Status-mapping tests (red)

**Files:** create `tests/status_mapping.rs`.

One test per row of the status table in *The store contract*, for all three functions, plus:
`task_update_action("pending")` and `("running")` return `Ignore`; `("killed")` returns
`End(Stopped)`; a test asserting `run_status` returns `Paused` for `"paused"` while
`task_update_action` returns `End(...)` (D6, AC 20/21); `run_status("nonsense")` returns `None`.

**Verify:** `cargo test -p mainframe-claude-workflows --test status_mapping` fails as unimplemented.

### Task 8 — Run-record and merge-precedence tests (red)

**Files:** create `tests/run_record.rs`, `tests/merge_precedence.rs`, and
`tests/fixtures/wf_run_record.json`.

The fixture carries the full key set from verified fact 5 (`runId, timestamp, taskId, script,
scriptPath, result, agentCount, logs, durationMs, summary, workflowName, status, startTime, phases,
defaultModel, workflowProgress, totalTokens, totalToolCalls`) with `status: "completed"` and a
`workflowProgress` array reusing the Task 6 shapes.

`run_record.rs`: `parse_run_record` maps `runId → run_id`, `taskId → task_id`,
`workflowName → workflow_name`, `status` through `run_status`, `totalTokens → total_tokens`,
`durationMs → duration_ms`, `workflowProgress` through `parse_snapshot`,
`structure_revision: Some(duration_ms)`, and `source: Record`; a record with `status: "killed"`
yields `Stopped`; a malformed record (not an
object) yields `None`; `read_run_records` on a `tempfile` dir containing two `wf_*.json` files plus
one unrelated file returns exactly two runs, and returns empty (not an error) when the directory does
not exist (constraint 8).

`merge_precedence.rs`: one test per numbered rule in *Merge precedence* — including the
**empty-record carve-out** (rule 2), the two-snapshot structural-revision rule (rule 3), and an
asymmetric identity test where memory has `run_id: None` while the terminal record has `Some(run_id)`
for the same `task_id`; the result must be one record-sourced run carrying the learned id.

**Verify:** both files fail as unimplemented under `cargo test -p mainframe-claude-workflows`.

### Task 9 — Store-lifecycle tests (red)

**Files:** create `tests/store_lifecycle.rs`.

1. `seed` then `runs_for_chat` returns one `Running`/`Launch` run keyed by `task_id`.
2. `link_run_id` fills `run_id` and `workflow_name`; a second call with a different id does not
   overwrite a known `run_id`.
3. `apply_progress` with `snapshot: None` advances cumulative `total_tokens`/`duration_ms`, leaves
   `phases` and `agents` byte-identical, and does not advance `structure_revision` (AC 12). A delayed
   liveness event with smaller totals cannot make either value decrease.
4. `apply_progress` with a snapshot sets `structure_revision` from that event's `usage.duration_ms`
   and replaces phases and agents wholesale. Applying an older snapshot with a smaller duration does
   not restore an earlier agent state; a same-revision snapshot is accepted so equal-millisecond
   cumulative updates are not lost (AC 13).
5. `stamp_status(Completed)` twice does not move `terminal_at` or `duration_ms` (idempotence edge).
6. `stamp_status(Paused)` sets `Paused` and freezes `duration_ms` at its current value.
7. `stop_all_running` stamps only `Running` runs `Stopped`, leaves terminal runs alone, and retains
   their last snapshot (AC 24, D5).
8. `subscribe()` receives one `RunEvent` per mutating call and none for a no-op call.
9. `remove_chat` drops the chat's runs.

**Verify:** `cargo test -p mainframe-claude-workflows --test store_lifecycle` fails as unimplemented.

### Task 10 — Adapter task-event tests (red)

**Files:** create `packages/core-rs/crates/mainframe-adapter-claude/tests/workflow_task_events.rs`.

Tests against the (not yet existing) `mainframe_adapter_claude::workflow_events` module:

1. `task_updated_payload` reads `patch.status` and `patch.end_time`, not the top-level `status`
   (AC 20, verified fact 2). Include a payload with **both** a top-level `status: "running"` and
   `patch.status: "completed"` and assert `patch` wins.
2. A `task_updated` whose `patch` is absent yields an empty status, which `task_update_action` maps
   to `End(Stopped)` with a warning — assert the payload shape, not the log.
3. `map_task_kind("local_workflow", false)` → `Workflow`; `map_task_kind("remote_agent", false)` →
   `Agent` (AC 23, kind split).
4. `parse_launch_result` (the `Workflow` tool-result scanner) extracts `taskId`, `runId`,
   `workflowName` from an `async_launched` result, returns `None` for non-JSON text, and returns
   `None` for a JSON object without a `runId`.
5. Three lock-regression tests drive public `events::handle_stdout` on a worker thread and require a
   completion signal within one second: one `task_updated`, one `task_notification`, and one user
   `Workflow` tool-result event. Seed each session through the same public event path, then assert the
   first two stamp terminal run state and the third links both the workflow store and background task
   tracker. These tests fail if any helper re-locks `ClaudeSessionState` while its caller holds the
   non-reentrant mutex.

**Verify:** `cargo test -p mainframe-adapter-claude --test workflow_task_events` fails to compile
(the module does not exist). This is the red state; record the compiler error.

### Task 11 — History-backfill integration test (red)

**Files:** create `packages/core-rs/crates/mainframe-server/tests/workflow_runs_history.rs`, modelled
on `tests/chat_background_activity.rs` (reuse its `support/` harness); edit
`tests/chat_background_activity.rs` to add `workflow_name: None` to its existing `TaskSeed` literal.

1. `GET /api/chats/{id}/messages` returns an `ok` envelope whose `data.workflowRuns` is `[]` for a
   chat that has never run a workflow (AC: "a session that never runs a workflow — nothing changes").
2. With a `wf_<runId>.json` written into the fake `<project_dir>/<sessionId>/workflows/`, the same
   route returns one run with the record's phases and agents and `source: "record"` (AC 17).
3. With both a retained in-memory snapshot **and** a terminal record for the same run, the response
   carries the record's structure (AC 16, D8). Make the memory run omit `run_id` while the record has
   it, proving the pairwise task-id fallback collapses the asymmetric late-link state.
4. With a retained snapshot and **no** record, the response carries the snapshot.

**Verify:** the file fails to compile (`ctx.claude_workflows` and the route field do not exist).
Record the error.

## Group `wf-core` — the workflow-run crate (core)

Turn each red test green in order. Do not add behavior the tests do not pin.

### Task 12 — `snapshot.rs`

Implement `parse_snapshot` over `&[Value]`: match `entry["type"]` on `"workflow_phase"`,
`"workflow_agent"`, `"workflow_log"`, ignoring anything else. Extract with typed `.get(...).and_then(...)`
helpers — never `unwrap`. Agent `state` maps `start|progress|done|error` and falls through to
`Unknown`. Sort phases by `index` and agents by `(phase_index, index)`. Keep entry mapping in private
helpers so no function exceeds 50 lines; revision assignment belongs in `store.rs`, where the event's
cumulative usage is available.

**Verify:** `cargo test -p mainframe-claude-workflows --test snapshot_parse` green.

### Task 13 — `status.rs`

Implement the three functions per the status table. `killed` must not log. The unknown arm logs
`tracing::warn!(status = %s, "unknown claude workflow task status")` exactly once per call.

**Verify:** `--test status_mapping` green.

### Task 14 — `record.rs`

`workflows_dir` joins `<project_dir>/<session_id>/workflows`. `read_run_records` uses
`tokio::fs::read_dir`, filters file names starting with `wf_` and ending `.json`, reads and
`serde_json::from_str`s each, and logs a `tracing::warn!` with the path on any read or parse failure
(no silent catches) while continuing with the rest. A missing directory returns an empty vec and logs
at `debug`, not `warn` (constraint 8 makes absence the normal interrupted-run case).
`parse_run_record` maps per Task 8's assertions and sets `structure_revision: Some(duration_ms)` when
`workflowProgress` is present; the record's source precedence, not that revision, makes it final.

**Verify:** `--test run_record` green.

### Task 15 — `merge.rs`

Implement `merge_runs` per the five numbered precedence rules. Do **not** build independent fallback
keys. Fold candidates into a vector and find the incumbent with a private
`fn same_run(a: &ClaudeWorkflowRun, b: &ClaudeWorkflowRun) -> bool`: compare ids only when both
`run_id` values exist, otherwise compare `task_id`. Keep precedence in a private
`fn wins(candidate: &ClaudeWorkflowRun, incumbent: &ClaudeWorkflowRun) -> bool` under 50 lines, and
copy a missing learned identity from the losing side before replacing or retaining.

**Verify:** `--test merge_precedence` green.

### Task 16 — `store.rs`, `reconcile.rs`, `bridge.rs`

`store.rs`: `DashMap<String, HashMap<String, ClaudeWorkflowRun>>` plus a
`broadcast::Sender<RunEvent>` with capacity 256 (matching the tracker). Every mutating method takes
the chat's entry, mutates, clones the run, drops the guard, then sends — never hold a `DashMap` guard
across a `send`. `apply_progress` updates `total_tokens` and `duration_ms` with
`max(current, incoming)`. With `snapshot: None` it changes nothing else, including
`structure_revision`. With a snapshot it uses incoming `usage.duration_ms` as the revision and
applies the wholesale phase/agent replacement only when the freshness rules permit; rejected
structure still preserves any larger cumulative totals. `stamp_status`
returns early when the run is already terminal (`status.is_terminal()`) so a duplicate signal is a
no-op and emits no event. `stop_all_running` stamps `Stopped` on every run whose status is `Running`.
`runs_for_chat` sorts as *Merge precedence* rule 5 describes. Split `apply_*` helpers into private
functions to stay under the limits; if `store.rs` approaches 300 lines, move the mutation helpers to
`store_mutations.rs` and re-export.

`reconcile.rs`: `spawn_terminal_reconcile` spawns a Tokio task that calls
`record::read_run_records`, finds the record whose `task_id` matches, and calls `store.apply_record`.
When no record is found it logs at `debug` and leaves the stamped status alone — the UI's
neutralization (AC 16 second half) handles it.

`bridge.rs`: `spawn_workflow_run_bridge` mirrors `main.rs:506` exactly — subscribe, loop, map
`RunEvent` to `DaemonEvent::ClaudeWorkflowRunUpdated`, `warn!` on `Lagged`, `break` on `Closed`.

**Verify:** `cargo test -p mainframe-claude-workflows` fully green; `cargo clippy -p mainframe-claude-workflows -- -D warnings`;
`cargo fmt --check`. Every file under 300 lines.

## Group `wf-adapter` — Claude adapter ingest (core)

### Task 17 — `workflow_events.rs` (new sibling module)

**Files:** create `packages/core-rs/crates/mainframe-adapter-claude/src/workflow_events.rs`; edit
`src/lib.rs` (+1 `pub mod` line) and `Cargo.toml` (+1 dependency
`mainframe-claude-workflows = { workspace = true }`).

Public surface:

```rust
pub fn task_updated_payload(event: &Value) -> TaskUpdatedPayload;   // reads patch.status / patch.end_time
pub struct LaunchResult { pub task_id: String, pub run_id: String, pub workflow_name: Option<String> }
pub fn parse_launch_result(text: &str) -> Option<LaunchResult>;
pub(crate) fn handle_task_progress(state: &ClaudeSessionState, event: &Value);
pub(crate) fn record_location(state: &ClaudeSessionState) -> Option<RecordLocation>;
pub(crate) fn link_launch(state: &ClaudeSessionState, text: &str);
```

The three state-bound helpers accept the caller's borrowed `ClaudeSessionState`; they must never call
`session.state.lock()`. This is load-bearing because `events.rs` holds the non-reentrant state mutex
through `task_updated` and `task_notification`, and `handle_user_event` holds it through the
tool-result loop.

`handle_task_progress` reads `task_id`, `usage.total_tokens`, `usage.duration_ms` and the optional
`workflow_progress` array, then calls the store available through `state.task_events`. It returns
early when `mainframe_chat_id` is empty. `record_location` builds `RecordLocation` from
`crate::transcript::get_session_jsonl_path(&state.chat_id, &state.real_project_path).project_dir` plus
`state.chat_id`. `link_launch` parses the result and delegates to `state.task_events.link_run_id`,
which updates the store and tracker without touching the session mutex. This is the only place the
workflow crate and adapter path logic meet, and it keeps `mainframe-claude-workflows` free of an
adapter dependency (no cycle).

**Verify:** run the `task_updated_payload`, `parse_launch_result`, and `map_task_kind` test-name
filters in `workflow_task_events` individually; those pure tests are green while the three dispatch
lock regressions remain red until Task 20. File under 300 lines.

### Task 18 — Store injection and tracker fields

**Files:** `src/adapter.rs` (+4), `src/session.rs` (+4), `src/task_events.rs` (constructor and field
only), and `mainframe-background-tasks/src/{tracker,reconcile,kill,liveness}.rs`.

- `ClaudeAdapter::new(background_tasks, workflow_store, resolved_path)` — a third parameter stored
  as `workflow_store: Arc<ClaudeWorkflowStore>`. Update `impl Default` (line 105) to construct a
  fresh store.
- `ClaudeTaskEvents::new` takes a second argument, `Arc<ClaudeWorkflowStore>`, stored as a field. Add
  `ClaudeTaskEvents::link_run_id(chat_id, task_id, run_id, workflow_name)`, which delegates to both
  the workflow store and tracker using their interior synchronization and never reaches
  `ClaudeSessionState`.
- Thread the store into `ClaudeSession` alongside `background_tasks` (see `session.rs:351–367`) and
  into the `ClaudeTaskEvents` construction. No public `workflow_store()` accessor is needed: all
  state-locked call sites delegate through the `ClaudeTaskEvents` value they already borrow.
- `tracker.rs`: `TaskSeed` gains `workflow_name: Option<String>`; `start` copies it and an initial
  `run_id: None` onto the `BackgroundTask`. Add
  `pub fn link_run_id(&self, chat_id: &str, task_id: &str, run_id: &str)` that sets `run_id` on a live
  task and emits `TaskEvent::Updated`; it is a no-op when the task is unknown or already carries that
  id. Add inline tests for the no-op and late-link branches.
- Update every existing `BackgroundTask` and `TaskSeed` literal owned by this crate: tracker
  production/test helpers, `reconcile.rs`'s recovered task, and the `kill.rs`/`liveness.rs` tests.
  Non-workflow literals set `workflow_name: None` and `run_id: None` as applicable.

**Verify:** `cargo test -p mainframe-background-tasks` is green;
`cargo check -p mainframe-adapter-claude` is green; `cargo check -p mainframe-daemon` now fails only
on the `ClaudeAdapter::new` arity and `AppCtx` field owned by Tasks 21–22.

### Task 19 — Rewire `task_events.rs` (dispatch only, net line change ≈ 0)

**Files:** `packages/core-rs/crates/mainframe-adapter-claude/src/task_events.rs` (630 lines — must
not grow).

- Add `pub end_time: Option<String>` to `TaskUpdatedPayload`.
- **Delete** the private `fn map_status` (lines 92–106) and route both call sites through
  `mainframe_claude_workflows::status::{task_update_action, terminal_task_status}`. Update the
  existing `mod tests` cases that referenced `map_status` to call the new functions.
- `handle_task_updated`: replace the three-status early return with
  `match task_update_action(&payload.status) { Ignore => {} , End(status) => self.tracker.end(...) }`,
  then unconditionally call the store: `run_status(&payload.status)` → `store.stamp_status(...)`, and
  when the resulting run status `is_terminal()`, `spawn_terminal_reconcile` with the location the
  caller threads in.
- `handle_task_notification`: use `terminal_task_status`, and stamp the store the same way.
- `TaskStartedPayload` gains `workflow_name`; `handle_task_started` calls
  `store.seed(chat_id, &task_id, workflow_name.clone())` when
  `map_task_kind(...) == BackgroundWorkKind::Workflow`, and its `TaskSeed` literal passes that same
  optional name.
- `handle_task_updated` / `handle_task_notification` gain a `loc: Option<RecordLocation>` parameter.

Keep each handler under 50 lines by extracting a private
`fn stamp_run(&self, chat_id: &str, task_id: &str, cli_status: &str, loc: Option<RecordLocation>)`.

**Verify:** `cargo test -p mainframe-adapter-claude task_events::tests` is green; run
`cargo test -p mainframe-adapter-claude --test workflow_task_events --no-run` to prove the helper
signatures line up, but leave its three dispatch tests for Task 20. `wc -l task_events.rs` ≤ 630.

### Task 20 — Dispatch arms in `events.rs` and `user_event.rs`

**Files:** `src/events.rs` (+4 lines net), `src/user_event.rs` (+3 lines net).

- `events.rs`: add a `task_progress` arm that locks once, borrows `&st`, and calls
  `crate::workflow_events::handle_task_progress(&st, event)` immediately before the catch-all. In the
  existing `task_started` payload construction, copy `event.workflow_name` into the new field.
- `events.rs`: in the `task_updated` arm (line 157), keep the existing guard, replace the inline
  payload construction with `crate::workflow_events::task_updated_payload(event)`, and pass
  `crate::workflow_events::record_location(&st)`. Do the same for `task_notification`. No helper in
  either arm may receive `&ClaudeSession` or acquire the state mutex. This shrinks
  `handle_system_event`, which is already over 50 lines; note the before/after line count.
- `user_event.rs`: inside the existing tool-result block loop (line 425), after
  `extract_tool_result_content`, call `crate::workflow_events::link_launch(st, &text)`. The function
  consumes the already-borrowed state and delegates through `ClaudeTaskEvents`; no parsing logic and
  no lock acquisition lands in `user_event.rs`.

**Verify:** `cargo test -p mainframe-adapter-claude --test workflow_task_events` passes all three
one-second lock-regression tests, then `cargo test -p mainframe-adapter-claude` is green. `git diff --stat`
on these two files shows `events.rs` net-negative or ≤ +4, `user_event.rs` ≤ +3.

## Group `wf-daemon` — daemon, server and chat wiring (core)

### Task 21 — Daemon construction and bridge

**Files:** `mainframe-daemon/src/main.rs` (+6 lines), `mainframe-daemon/Cargo.toml` (+1 dep), and
`mainframe-daemon/tests/{boot_routes_integration,health_integration}.rs`.

After line 196, `let claude_workflows = Arc::new(ClaudeWorkflowStore::new());`. Pass
`Arc::clone(&claude_workflows)` as `ClaudeAdapter::new`'s second argument. Beside
`spawn_task_event_bridge` (line ~210) add
`spawn_workflow_run_bridge(Arc::clone(&claude_workflows), broadcast.clone());`. Pass the store into
the production `AppCtx` construction. Add a fresh store to both daemon integration-test `AppCtx`
literals.

**Verify:** `cargo check -p mainframe-daemon` and
`cargo test -p mainframe-daemon --test boot_routes_integration --test health_integration` clean.
`git diff --stat main.rs` ≤ +6.

### Task 22 — `AppCtx` field and chat deps

**Files:** `mainframe-server/src/ctx.rs`, `mainframe-server/Cargo.toml`,
`src/routes/{adapters,automations_test_support,quota,background_tasks}.rs`, and
`tests/support/mod.rs`.

Add `pub claude_workflows: Arc<ClaudeWorkflowStore>` to `AppCtx` (line ~95), directly after
`background_tasks`. Populate every server-owned `AppCtx` literal found by `rg -F 'AppCtx {'`: the
`ctx.rs` test builder, the adapters/quota route test builders, the automations harness, and the shared
integration-test support builder. Task 21 owns the three daemon-side literals.

Also finish the server-owned task-shape propagation: add `workflow_name: None` to
`background_tasks.rs`'s `TaskSeed` literal and `workflow_name: None, run_id: None` to its adopted
`BackgroundTask` literal.

**Verify:** `cargo check -p mainframe-server` shows only the chat-history and chat-deps errors owned by
Tasks 23–25; `cargo test -p mainframe-server background_tasks` compiles.

### Task 23 — D5: the CLI-exit workflow stop

**Files:** `mainframe-chat/src/event_handler.rs` (+3), `mainframe-chat/src/chat_manager.rs` (+4),
`mainframe-server/src/chat_deps.rs` (+6), and the five test doubles listed in verified fact 10 (+1
line each).

- `EventHandlerDeps` (event_handler.rs:98) gains `fn workflow_runs_stop_all(&self, chat_id: &str);`
  directly after `tracker_end_all_running`.
- `on_exit` (event_handler.rs:1012) calls it on the line after the tracker sweep, with a one-line
  comment naming D5 and issue #273.
- `ChatManagerDeps` (chat_manager.rs:269) gains the same method; the `EventHandlerDeps` impl at
  chat_manager.rs:492 delegates.
- `chat_deps.rs:674`-area production impl calls `self.claude_workflows.stop_all_running(chat_id)`.
  Add a unit test beside `tracker_end_all_running_delegates_to_the_background_task_tracker`
  (chat_deps.rs:1332) named `workflow_runs_stop_all_delegates_to_the_workflow_store`, asserting a
  seeded `Running` run becomes `Stopped` with its snapshot retained (AC 24).
- The five test doubles get an empty body with the same `/// Empty on purpose:` comment style the
  file already uses, pointing at the chat_deps test.
- Finish chat-owned task-shape propagation in files already touched by this task: the
  `event_handler.rs` `TaskSeed` helper and `chat_deps.rs` seed set `workflow_name: None`; the
  `chat_manager/tests.rs` `BackgroundTask` and `BackgroundActivityTask` helpers set
  `workflow_name: None, run_id: None`.

**Verify:** `cargo test -p mainframe-chat -p mainframe-server chat_deps` green, including compilation
of every listed test double and helper literal.

### Task 24 — Backfill composer

**Files:** create `mainframe-server/src/routes/chat_workflow_runs.rs`; edit
`mainframe-server/src/routes/mod.rs` (+1 `mod` line).

```rust
pub async fn workflow_runs_for_chat(ctx: &AppCtx, chat_id: &str) -> Vec<ClaudeWorkflowRun>;
```

1. `let memory = ctx.claude_workflows.runs_for_chat(chat_id);`
2. Resolve the chat row from `ctx.db`, take `claude_session_id` and the effective cwd
   (`chat.worktree_path` falling back to the project path) exactly as
   `chat_manager.rs:2065 build_history_session` does. Return `memory` unchanged when either is
   missing, logging at `debug`.
3. `let project_dir = mainframe_adapter_claude::transcript::get_session_jsonl_path(&session_id, &cwd).project_dir;`
4. `let records = record::read_run_records(&project_dir, &session_id).await;`
5. `merge_runs(memory, records)`.

Add a module docstring stating A5's bound: only the chat's current session id is scanned, and runs
from a pre-resume session id fall through to the Unavailable state.

**Verify:** `cargo check -p mainframe-server` clean. File under 300 lines; the function under 50
(extract the chat-row resolution into a private helper).

### Task 25 — Extend the history route

**Files:** `mainframe-server/src/routes/chats.rs` (+3 lines in `async fn messages`, line 143) and
`mainframe-chat/src/chat_manager.rs` (+1 field in the existing payload constructor).

Initialize `ChatManager::get_display_messages`'s `ChatHistoryPayload` with `workflow_runs: Vec::new()`,
then compose the server-owned async backfill:

```rust
let mut payload = cm.get_display_messages(&id).await;
payload.workflow_runs = chat_workflow_runs::workflow_runs_for_chat(&ctx, &id).await;
ok(payload)
```

No new route, no new Zod schema (see the AC 26 scope note).

**Verify:** `cargo test -p mainframe-server --test workflow_runs_history` — all four Task 11 tests
green. Then `cargo test` for the whole `packages/core-rs` workspace once, and `cargo clippy --workspace -- -D warnings`.

## Group `ui-tests` — red-phase UI tests (test)

Run each with `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` (single file — batches hit
the cross-file `React.act` failure). Every test must be observed failing first.

### Task 26 — Pure view-model tests

**Files:** create `packages/ui/src/features/chat/workflow/__tests__/workflow-progress.test.ts` and
`__tests__/workflow-agent-view.test.ts`.

Against the (not yet written) pure modules:

- `parseWorkflowLaunch(result)` returns `{taskId, runId, workflowName}` from an `async_launched`
  result; returns `{error}` for a result carrying an error and no run id (spec "Launch failed");
  returns `{}` for junk.
- `runMetaString(run, now)` joins with ` · ` exactly: agent count, failed count when non-zero,
  unknown count when non-zero, `running` while live, run tokens, duration — one test per omission
  case, and one asserting the full string (AC 2, D18: **no phase title**).
- `outcomeDot(run, now)` returns each of the six variants from AC 3.
- `statusChipLabel` returns exactly one of `Running|Completed|Failed|Stopped|Paused|Unavailable` (AC 7).
- `summarizeRun(run, now)` names the **deepest phase that has spawned an agent**, including the case
  where the only unfinished agent errored in an earlier phase (AC 8), and emits
  `X of Y done`, `N running`, `N failed`, `N unknown` with zeros omitted.
- `neutralizeStaleAgents(run, now)`: with `run.status === 'stopped'`, agents in `start`/`progress`
  become `unknown`; agents in `done`/`error` are untouched; observed tokens survive (D14, AC 18).
- `agentDetailLine(agent, run)` returns exactly one line by the precedence stale → error →
  resultPreview → lastToolName·lastToolSummary → null — one test per rung (AC 11).

### Task 27 — Launcher-row tests

**Files:** create `__tests__/WorkflowLauncherRow.test.tsx`.

- Renders `data-testid="chat-workflow-launcher-<runId>"` with the workflow name and the meta string;
  it does **not** expand in place (AC 1, 2).
- Each dot variant renders its expected class/tone (AC 3).
- Clicking opens `data-testid="chat-workflow-panel-<runId>"` with **no** breadcrumb element (AC 4).
- A launch-failure result (error, no run id) renders a non-interactive row with the error text and
  no clickable trigger (spec edge case).
- A tool call with no result yet renders immediately with a running dot (spec edge case).

### Task 28 — Panel tests

**Files:** create `__tests__/WorkflowRunPanel.test.tsx`.

- Header shows name, status chip, right-aligned run tokens and duration (AC 7).
- Every seeded phase renders in index order as `chat-workflow-phase-<index>`; a phase with no agents
  reads `not started` (AC 9).
- Agents render under their phase in index order as `chat-workflow-agent-<agentId>` with a state dot,
  label, tokens and duration, and with model, attempt and tool count in the element `title` (AC 10, D19).
- An agent in the `error` state shows its error text as the single detail line (AC 11).
- A `stopped` run renders hollow-ring `unknown` rows with dimmed metrics, a "Last observed Ns before
  the run stopped" detail line, and the banner naming the unknown count (AC 18).
- An `unavailable` run renders "Run details unavailable", one explanatory line, the run id in the
  header, and **no** phase list, agent rows or counters (AC 19).
- A snapshot with no agents, and a run with no phases, render without error (spec edge case).

### Task 29 — Two-level activity-popover tests

**Files:** modify `packages/ui/src/features/chat/composer/__tests__/BackgroundActivityBar.test.tsx`.

Keep every existing assertion. Add:

- A live workflow task renders a clickable row with the workflow name and agent count at
  `data-testid="chat-background-workflow-<runId>"`; agent and bash rows stay non-interactive (AC 5).
- Clicking it swaps the popover body for the run panel with a `‹ Background activity` breadcrumb at
  `data-testid="chat-workflow-back-<runId>"`; clicking the breadcrumb returns to the list (AC 6).
  Assert both ids from the rendered DOM and drive navigation through those elements.
- The pill stays mounted while the popover is open even after the live set empties (spec edge case).
- Switching `chatId` closes the popover (spec edge case).

### Task 30 — Controller/state tests

**Files:** create
`packages/ui/src/features/chat/controller/__tests__/chat-thread-state-workflow-runs.test.ts` and
`__tests__/handle-daemon-event-workflow.test.ts`; edit
`__tests__/chat-thread-state-background.test.ts`.

- `handleDaemonEvent` maps `claude_workflow.run.updated` to a `workflow.run.updated` reducer event.
- The reducer upserts by `taskId`, replaces an existing run wholesale, and leaves other slices alone.
- `history.loaded` carrying `workflowRuns` seeds the slice (AC 15/17 restore path) and **replaces**
  rather than merges.
- An event for an unknown `taskId` inserts it rather than dropping it (a run adopted mid-stream).
- The background-state test proves a reconnect `background.snapshot` whose only change is the newly
  learned identity is **not** treated as equal, then proves a subsequent field-identical snapshot
  returns the same state reference. This pins both late-link and reconnect behavior.

**Verify (all of Group ui-tests):** each file fails (module-not-found or assertion). Record the
output before any ui-state/ui-view work begins.

## Group `ui-state` — controller wiring (ui)

### Task 31 — Pure run slice

**Files:** create `packages/ui/src/features/chat/controller/chat-workflow-runs.ts`.

```ts
export type WorkflowRunsSlice = Readonly<Record<string, ClaudeWorkflowRun>>;   // keyed by taskId
export function upsertWorkflowRun(slice: WorkflowRunsSlice, run: ClaudeWorkflowRun): WorkflowRunsSlice;
export function seedWorkflowRuns(runs: readonly ClaudeWorkflowRun[]): WorkflowRunsSlice;
```

Both return the same reference when nothing changes, so React skips the re-render.

**Verify:** `vitest run .../chat-thread-state-workflow-runs.test.ts` — the slice-level assertions pass.

### Task 32 — State field and reducer events

**Files:** `packages/ui/src/features/chat/controller/chat-thread-state.ts` (518 lines — **budget +12
lines, all delegating**).

Add `readonly workflowRuns: WorkflowRunsSlice;` beside `backgroundTasks` (line 91) with a short
docstring, two `ChatStateEvent` members (`{ type: 'workflow.run.updated'; run: ClaudeWorkflowRun }`
and `{ type: 'workflow.runs.snapshot'; runs: ClaudeWorkflowRun[] }`), the initial `{}` in
`createChatThreadState`, an optional `workflowRuns?: ClaudeWorkflowRun[]` on the existing
`history.loaded` event, and three reducer arms that call straight into Task 31's functions.

Extend `sameBackgroundTasks` to compare `workflowName` and `runId` as well as the existing fields.
This keeps identical reconnect snapshots identity-stable without dropping an identity learned after
the initial `task_started` projection.

**Verify:** `vitest run .../chat-thread-state-workflow-runs.test.ts` green;
`wc -l chat-thread-state.ts` ≤ 530.

### Task 33 — Event and load-path wiring

**Files:** `handle-daemon-event.ts` (+4), `chat-thread-controller.ts` (+2).

- `handle-daemon-event.ts`: a `case 'claude_workflow.run.updated'` beside the
  `background_task.*` block (line 110) returning `{ kind: 'event', event: { type: 'workflow.run.updated', run: event.run } }`.
- `chat-thread-controller.ts`: in the load path (lines 200–238) pass
  `workflowRuns: payload.workflowRuns` into the `history.loaded` dispatch. No new REST call — the
  runs ride the round trip the controller already makes on open, switch and reattach.

**Verify:** `vitest run .../handle-daemon-event-workflow.test.ts` and
`vitest run .../chat-thread-controller-load.test.ts` green;
`pnpm --filter @qlan-ro/mainframe-ui typecheck`.

## Group `ui-view` — panel, launcher row, popover (ui)

**Read the `mainframe-design-system` skill before writing any markup in this group.** Class recipes
come from the prototype (`workflow-details-PROTOTYPE/`, verified fact 13) — copy the recipes, import
nothing from it. Remember the compressed integer spacing scale (`p-2` = 4px; `px-1.5`, `pt-3.5` are
standard fractional steps) and that `mf-*` typos render as nothing with no error.

### Task 34 — Pure view-model modules

**Files:** create `workflow/workflow-progress.ts` (run-level: `parseWorkflowLaunch`, `summarizeRun`,
`runMetaString`, `outcomeDot`, `statusChipLabel`, `formatRunTokens`, `formatRunDuration`) and
`workflow/workflow-agent-view.ts` (agent-level: the `ViewAgent` type, `neutralizeStaleAgents`,
`agentDetailLine`, `agentDotTone`, `agentTitle`).

Reuse `formatElapsed` from `BackgroundActivityBar.tsx` (already exported) rather than adding a third
duration formatter.

**Verify:** `vitest run .../workflow-progress.test.ts` and `.../workflow-agent-view.test.ts` green.
Both files under 300 lines, every function under 50.

### Task 35 — Run lookup hook

**Files:** create `workflow/use-workflow-run.ts`.

`export function useWorkflowRun(taskId: string | undefined): ClaudeWorkflowRun | undefined` reading
`useChatExtras()?.state.workflowRuns` (the pattern at `BackgroundActivityBar.tsx:58`). Returns
`undefined` when the chat has no run for that task — the callers render the Unavailable state.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Task 36 — Header, stale banner, unavailable body

**Files:** create `WorkflowRunPanelHeader.tsx`, `WorkflowStaleBanner.tsx`, `WorkflowRunUnavailable.tsx`.

Header: workflow name, status chip (`STATUS_LABEL`/`STATUS_CHIP` records from the prototype), the
summary line from `summarizeRun`, right-aligned run tokens and duration; shell
`flex items-start gap-2.5 border-b border-border px-2.5 py-2.5`. Banner: one sentence naming the
unknown-outcome count and how long before the stop they were last seen. Unavailable body: the
"Run details unavailable" title, one explanatory line, and the run id where the summary would be.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`; each file under 150 lines.

### Task 37 — Phase list and agent row

**Files:** create `WorkflowPhaseList.tsx` and `WorkflowAgentRow.tsx`.

Phase list renders every seeded phase in index order with
`data-testid={`chat-workflow-phase-${phase.index}`}` (add the one-line comment that `index` is the
CLI's domain id), its kind and agent count, `not started` when it has no agents, and
`pt-0.5` on the first header / `pt-3.5` on the rest. Agent row:
`data-testid={`chat-workflow-agent-${agent.agentId}`}`, `rounded-sm px-1.5 py-1.5`, state dot
(hollow `border border-mf-text-3` when neutralized), truncated label, right-aligned tokens and
duration, `title` carrying label · model · attempt · tool count, and at most one detail line from
`agentDetailLine`.

**Verify:** `vitest run .../WorkflowRunPanel.test.tsx` — the phase and agent assertions pass (panel
assembly lands next).

### Task 38 — The panel

**Files:** create `WorkflowRunPanel.tsx`.

`data-testid={`chat-workflow-panel-${runId}`}`, an optional `onBack` prop that renders the
`‹ Background activity` breadcrumb only when supplied (AC 4 vs AC 6). The breadcrumb is a button
with `data-testid={`chat-workflow-back-${runId}`}`. The body is
`min-h-0 flex-1 overflow-y-auto px-1 py-1.5` inside `flex max-h-[min(440px,56vh)] flex-col`. It
composes Tasks 36–37 and short-circuits to `WorkflowRunUnavailable` when the run is missing or its
status is `unavailable`.

**Verify:** `vitest run .../WorkflowRunPanel.test.tsx` fully green.

### Task 39 — Launcher row and registry

**Files:** create `WorkflowLauncherRow.tsx`; edit
`packages/ui/src/features/chat/tools/register-cards.ts` (+3 lines).

A `ToolCallMessagePartComponent` that parses its own `result` with `parseWorkflowLaunch`, looks the
run up with `useWorkflowRun(taskId)`, and renders the collapsed row:
`flex w-full items-center gap-[9px] rounded-lg border border-border bg-card px-[10px] py-[7px] text-left transition-colors hover:border-mf-border-hover`,
containing the workflow glyph tile, the outcome dot, the name, the meta string and a chevron. Clicking
opens a Radix `Popover` (`components/ui/popover.tsx`) anchored to the row containing
`WorkflowRunPanel` with no `onBack`. A launch-failure result renders a non-interactive row.

`register-cards.ts`: `TOOL_REGISTRY.Workflow = WorkflowLauncherRow;` and
`TOOL_REGISTRY.RunWorkflow = WorkflowLauncherRow;`.

**Verify:** `vitest run .../WorkflowLauncherRow.test.tsx` green;
`vitest run packages/ui/src/features/chat/tools/__tests__/tool-dispatch.test.tsx` still green.

### Task 40 — Two-level activity popover

**Files:** create `composer/WorkflowActivityPopover.tsx`; edit `composer/BackgroundActivityBar.tsx`
(103 lines — keep it under 300 by moving the popover body out, not by growing it).

Extract the popover content into `WorkflowActivityPopover.tsx` with a `level` state
(`'list' | 'run'`): the list is today's rendering plus clickable workflow rows (glyph, workflow name
from `task.workflowName`, agent count from the looked-up run, chevron). Each interactive workflow
row requires `task.runId` and carries
`data-testid={`chat-background-workflow-${task.runId}`}`; a workflow entry not yet linked to a run id
renders inert until the tracker update arrives. The run level renders `WorkflowRunPanel` with
`onBack`, whose breadcrumb carries `data-testid={`chat-workflow-back-${runId}`}`. Width transitions
`cn('p-0 transition-[width] duration-150', level === 'list' ? 'w-80' : 'w-[380px]')`, and
`onOpenAutoFocus={(e) => e.preventDefault()}`. `BackgroundActivityBar.tsx` keeps its pill, owns the
`open` state, stays mounted while `open` even when the live set empties, and resets `open` and
`level` when the chat id changes.

**Verify:** `vitest run .../BackgroundActivityBar.test.tsx` fully green; both files under 300 lines.

## Group `verify` — final gate

### Task 41 — Full verification sweep

No files. Run, from `<worktree>`:

1. Run the CI dependency builds exactly: `pnpm build:types && pnpm build:core`, then
   `pnpm --filter @qlan-ro/mainframe-types test`.
2. Run both CI TypeScript checks exactly: `pnpm --filter @qlan-ro/mainframe-ui typecheck` and
   `pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit`.
3. Every touched UI test file individually via
   `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` (never a batch — see the `React.act`
   trap in `app-tauri-vitest-batch-react-act`). Include the pre-existing
   `new-thread-create-once`, background-state, and background-event files changed for required-field,
   late-link, and reconnect coverage.
4. From `packages/core-rs`: `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`,
   `cargo test --workspace`.
5. `pnpm changeset status`.
6. Line-limit sweep: `find` every file in the *Files touched* table and assert ≤ 300 lines, and
   re-read the four already-over-limit adapter/chat files to confirm their diffs are dispatch-only.
7. Walk the spec's 30 acceptance criteria one at a time and name the test or file that satisfies each.

**Verify:** all seven steps clean, with the AC walk recorded in the task summary.

---

## Risks

1. **A5's session-id bound.** Runs from a pre-resume Claude session id in the same chat are not
   backfilled and render Unavailable. Widening the scan to the chat's whole session lineage would
   need the lineage, which no current call site returns. Flagged for the user.
2. **The `Workflow` tool result's exact serialization.** Todo constraint 6 names the fields but not
   whether the daemon sees them as a JSON object or JSON-in-text. `parse_launch_result` handles both
   and returns `None` otherwise; when it returns `None` the run keeps `run_id: None`, the
   background-activity entry loses its run id (a partial AC 22 miss) and only the transcript launcher
   row can open the panel. Task 10's tests pin both shapes so the failure is loud, not silent.
3. **The five `EventHandlerDeps`/`ChatManagerDeps` test doubles** (Task 23) are a known
   merge-conflict surface if another branch is touching `event_handler.rs`.
4. **Cargo disk growth.** This worktree has no `target/` yet; a full `cargo test --workspace` will
   build the whole daemon cold. Budget the time and sweep afterwards per the Disk Hygiene section.
