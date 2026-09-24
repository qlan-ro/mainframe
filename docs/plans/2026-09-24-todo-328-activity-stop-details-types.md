# Plan: Activity enhancements (stop, details, missing types) — todo #328

Spec: `docs/specs/2026-09-24-todo-328-activity-stop-details-types.md` (committed at `8876dcda`).
Acceptance criteria are referenced as AC1–AC22 from that spec.

## Goal

Activity rows gain a capability-gated stop control, a drill-in detail view with an on-demand
output tail, terminal-row retention with dismissal, a Monitor kind, and the CLI's reported
task type. The daemon changes are additive: it records `reported_type`, widens the activity
projection, adds a `stopBackgroundTask` capability flag, settles recovered orphans on kill,
and splits `no_output` from `invalid_path`.

Expected diff: roughly 1.5k lines, including tests, across Rust and TypeScript. The full
form of this plan applies.

## Groups

| Group | Kind | Owns | Depends on |
|---|---|---|---|
| `daemon` | core | `packages/core-rs/**` | — |
| `client-state` | core | `packages/types/src/**`, `packages/ui/src/lib/api/**`, `packages/ui/src/features/chat/controller/**`, `packages/ui/src/features/chat/runtime/chat-extras.ts` | — |
| `activity-ui` | ui | `packages/ui/src/features/session-panel/**`, `packages/e2e/tests-tauri/session-panel.spec.ts`, `.changeset/*` | `client-state` |

`daemon` and `client-state` share no files. They agree on the wire through the contract in
the next section, not through a shared fixture file. `activity-ui` consumes `client-state`'s
types, API module, reducer state and extras actions.

## Wire contract (both sides implement exactly this)

**`BackgroundTask`** gains `reportedType` (the CLI's raw `task_type`). It is optional. Rust
declares it as `Option<String>` with `skip_serializing_if = "Option::is_none"`, and TS as
`reportedType?: string`.

**`BackgroundActivityTask`** (projection) keeps `id, kind, description, startedAt, workflowName?, runId?`
and adds these optional fields (Rust uses `Option` plus `skip_serializing_if`; TS uses `?`):

| Key | Type | Projection rule |
|---|---|---|
| `status` | `BackgroundTaskStatus` | always set from the task |
| `toolName` | `'Bash' \| 'Monitor'` | always set |
| `command` | string | always set (raw command; `description` keeps its command fallback) |
| `outputPath` | string | set only when non-null |
| `endedAt` | number | set only when non-null |
| `lastOutputLine` | string | set only when non-null |
| `summary` | string | set only when non-null |
| `usage` | `{ totalTokens, toolUses, durationMs }` | set only when non-null |
| `recovered` | boolean | set only when the task carries it |
| `reportedType` | string | set only when present |

Field-set parity (AC18): for a fully populated terminal task, both `to_activity_task`
(serialized with serde) and `toActivityTask` (after `JSON.parse(JSON.stringify(...))`) emit
exactly `{id, kind, description, startedAt, status, toolName, command, outputPath, endedAt,
lastOutputLine, summary, usage, recovered, reportedType, workflowName, runId}`. For a
running task with only the required fields, both emit exactly
`{id, kind, description, startedAt, status, toolName, command}`. Each side pins both key
sets in its own test. The TS Zod schema must also parse a legacy payload that has only
`{id, kind, description, startedAt}`.

**`AdapterInfo.capabilities`** gains `stopBackgroundTask`. In Rust it is
`#[serde(default)] pub stop_background_task: bool`: always emitted, and false when absent
on read. In TS it is `stopBackgroundTask?: boolean`, where absent means unsupported. Values:
Claude `true`, Codex `false`, Mock `false`. Each value reflects the adapter's
`stop_background_task` implementation.

**Output route** `GET /api/chats/{chatId}/background-tasks/{taskId}/output?bytes=N` returns
200 `text/plain` with the tail on success. On failure it returns the envelope
`{success:false, error}` with one of: 404 `task not found`, 409 `no_output`,
409 `invalid_path`, 400 `bad request`, or 500 `read failed`. The only new behavior is that
an absent file in a valid spool directory returns 409 `no_output`.

**Kill route** `POST …/{taskId}/kill` returns `{success:true}`, 404 `task not found`, or
502 `{success:false, error}` (unchanged). The one change: a recovered task with no live
writer now returns success.

---

## Group `daemon` (core)

TDD per task: write the failing Rust test first, then the change.

1. **Record the reported type.** Add `reported_type: Option<String>` to `TaskSeed`
   (`mainframe-background-tasks/src/tracker.rs`). Add it to `BackgroundTask`
   (`mainframe-types/src/background_task.rs`). `BackgroundTaskTracker::start` copies it
   through. `TaskEventBridge::handle_task_started`
   (`mainframe-adapter-claude/src/task_events.rs`) passes `payload.task_type.clone()`, and
   `map_task_kind` still decides `kind`. Every other `TaskSeed {…}` and `BackgroundTask {…}`
   literal passes `None`: codex `collab_activity.rs`, mock `task_bridge.rs`,
   `reconcile.rs`, `liveness.rs`, `kill.rs` tests, `chat_manager/tests.rs`,
   `event_handler.rs` tests, `routes/background_tasks.rs` tests, and the server
   integration tests. *Verify:* a `task_events` test shows a `task_started` with
   `task_type: "container_exec"` yields kind `Other` and `reported_type ==
   Some("container_exec")` on the tracked task (AC17). The existing event fixtures still
   round-trip.
2. **Widen the projection.** Add the optional fields from the wire contract to
   `BackgroundActivityTask`. `to_activity_task` fills them. Update the literals in the
   module's tests and in `mainframe-chat/src/chat_manager/tests.rs`. *Verify:* the
   `background_task.rs` tests pin both key sets from the contract through
   `serde_json::to_value(...).as_object().keys()`. An unmapped `container_exec` task
   projects `reportedType: "container_exec"` (AC17, AC18).
3. **Stop capability flag.** Add `stop_background_task` to `AdapterCapabilities`
   (`mainframe-types/src/adapter.rs`, with `#[serde(default)]`). Set it in the Claude
   (`true`), Codex (`false`) and Mock (`false`) `capabilities()`. Then fix the remaining
   literal sites: `adapter-api/tests/registry.rs`, `chat/src/context_tracker.rs`,
   `server/src/chat_deps.rs`, `server/src/routes/session_transcripts.rs`,
   `server/tests/{chat_default_model_catalog.rs, support/barrier_adapter.rs,
   transcript_presence_support/mod.rs}`. *Verify:* unit tests in the Claude and Codex
   adapter crates assert `capabilities().stop_background_task` is `true` and `false`
   respectively (AC6). Deserializing `{"planMode":true,"autoMode":false}` yields `false`.
4. **Recovered orphan kill.** In `kill_background_task` (`kill.rs`), when
   `kill_one_task_os` returns `OsKillReason::NoWriter` or `NoOutputPath` and
   `task.recovered == Some(true)`, call `tracker.end(...)`. It passes
   `status: Stopped` and `summary: "No live process — marked stopped."`, keeps
   `output_path`, sets `usage: None`, and returns `KillResult::Ok { via: Via::None }`. It
   does this whether or not a session is present. Non-recovered tasks keep today's `Err`.
   *Verify:* new inline tests. (a) A recovered task that was adopted, with an empty lsof
   result and `session: None`, gets `Ok`. The tracker then shows `Stopped` with that
   summary, and a subscriber receives `TaskEvent::Ended` (AC8). (b) A non-recovered task
   with no writer and `session: None` still gets `Err { error: "no live writer", .. }`.
5. **Split `no_output` from `invalid_path`.** In `spool_validator.rs`, add
   `pub enum SpoolCheck { Valid, MissingFile, Invalid }` and a `SpoolValidator::check`
   trait method. Its default impl maps `validate` to `Valid`/`Invalid`, so reconcile's test
   doubles are untouched. `MadeSpoolValidator` overrides `check`. When `realpath(output)`
   fails, it first calls `tokio::fs::symlink_metadata(output)`. If an entry exists (for
   example a dangling link), the result is `Invalid`. If the error is `NotFound`, it
   resolves the parent directory with `realpath` and runs the existing
   root-prefix/`tasks`-segment/basename rules against `resolved_parent/basename`. If they
   pass, the result is `MissingFile`; otherwise it is `Invalid`. `validate` becomes
   `check(..) == Valid`. The `output` handler (`routes/background_tasks.rs`) maps
   `MissingFile` to 409 `no_output` and `Invalid` to 409 `invalid_path`. *Verify:* in
   `server/tests/routes_background_tasks_output.rs`, following the existing
   real-spool-root pattern and skipping when uid is 0: (a) a `tasks/` directory inside
   `claude-<uid>` with no `<id>.output` returns 409 `no_output`; (b) `<id>.output` as a
   symlink to a file outside the spool returns 409 `invalid_path` (AC11). The existing tail
   test and the `rejects_a_path_outside_the_spool_root` test still pass. Unit tests in
   `mainframe-background-tasks/tests/spool_validator.rs` cover `check` for the three
   outcomes, using the injectable `realpath`.

**Group exit:** `cargo test` passes for `mainframe-types`, `mainframe-background-tasks`,
`mainframe-adapter-claude`, `mainframe-adapter-codex`, `mainframe-adapter-mock`,
`mainframe-chat` and `mainframe-server`. `cargo clippy` is clean for those crates. AC12 is
satisfied by the existing `returns_the_tail_of_a_spool_file_under_the_real_spool_root` and
`spool_root_default_uid.rs` tests, which must still pass. No uid code is touched.

---

## Group `client-state` (core, TypeScript)

TDD per task. Rebuild `@qlan-ro/mainframe-types` after task 1 so the UI resolves the new
types.

1. **Types** (`packages/types/src/background-task.ts`, `adapter.ts`). Add
   `BackgroundTask.reportedType?`, the new optional `BackgroundActivityTask` fields with
   their Zod schema (the `status` and `toolName` enums, and the `usage` object), and
   `stopBackgroundTask?: boolean` in both `AdapterInfo.capabilities` and
   `Adapter.capabilities`. `toActivityTask` fills fields per the contract and omits null
   values rather than emitting `undefined`/`null`. *Verify:* in
   `__tests__/background-activity.test.ts`, the schema parses the legacy four-field
   payload and a fully populated one. Both contract key sets hold after a JSON round trip.
   `reportedType` passes through (AC17, AC18).
2. **API module** `packages/ui/src/lib/api/background-tasks.ts` (AC19).
   - `killBackgroundTask(chatId, taskId)` resolves to
     `{kind:'ok'} | {kind:'not-found'} | {kind:'error', message}`.
   - `getBackgroundTaskOutput(chatId, taskId, bytes = 8192)` resolves to
     `{kind:'text', text} | {kind:'none'} | {kind:'error', message}`.
   - Both are built on `apiBase()` and the daemon's auth. Export `fetchChecked` from
     `http.ts` (or add an equivalent exported raw-fetch helper there) so remote 401s
     still mark auth failure.
   - Kill parses every JSON body with a Zod envelope union
     (`{success:true}` | `{success:false, error:string}`).
   - Output treats a 2xx as text and Zod-parses non-2xx bodies as the failure envelope.
     `no_output` maps to `none`, and any other `error` maps to `error`.
   - A body that fails to parse maps to `error` with a readable message. Neither function
     throws on HTTP failure.

   *Verify:* `lib/api/__tests__/background-tasks.test.ts` uses mocked `fetch`. It covers
   kill ok, 404 `task not found` returning `not-found`, and 502 with an error string. It
   covers output text, `?bytes=8192` in the URL, `no_output` returning `none`,
   `invalid_path`/`read failed` returning `error`, and a malformed body.
3. **Reducer** in a new pure module `features/chat/controller/background-activity-state.ts`.
   `chat-environment-state.ts` delegates its `background.*` cases to it, which keeps both
   files under 300 lines. The slice holds `backgroundTasks` (running and terminal
   entries, keyed by id) and a new `backgroundStops: Record<taskId, {phase:'stopping'} |
   {phase:'error', message}>`. Events:
   - `background.upsert {task}` inserts or replaces a running entry.
   - `background.ended {task}` is a no-op when the id is not listed (AC14, never listed).
     Otherwise it stores the terminal projection, drops `backgroundStops[id]`, and then
     enforces the cap of 5 terminal rows, dropping the smallest `endedAt` first.
   - `background.snapshot {tasks}` keeps every terminal entry. It drops running entries
     that are absent from the snapshot. It adds or refreshes snapshot tasks unless the id
     is already terminal, in which case the terminal entry wins. It prunes
     `backgroundStops` for removed ids but keeps a `stopping` phase across a snapshot that
     still lists the task. It stays identity-stable when nothing changed; extend
     `sameBackgroundTasks` to compare the new fields that can change (`status`, `command`,
     `toolName`, `recovered`, `reportedType`, `outputPath`).
   - `background.dismissed {taskId}` removes the row only if it is terminal.
   - `background.turn.started` clears every terminal row and leaves running rows alone.
   - `background.stop.requested {taskId}` sets `stopping`, but only for a listed running
     row.
   - `background.stop.failed {taskId, message}` sets `error`. It is ignored if the row is
     terminal or absent, so a late failure never reverts a terminal row.
   - `background.removed {taskId}` deletes the row and its stop state.

   Add the new cases to the `reduceChatThreadState` delegation list
   (`chat-thread-state.ts`). `handleDaemonEvent`: `background_task.started`/`.updated` with
   `status === 'running'` map to `upsert`. A non-running status, and
   `background_task.ended`, map to `background.ended` with `toActivityTask(event.task)`.
   *Verify:* pure reducer tests cover AC14's six rules, stopping persisting across a
   snapshot, stop failure ignored on a terminal row, and ended clearing the stop state.
   Update `chat-thread-state-background.test.ts`,
   `chat-event-router-background-snapshot.test.ts` and
   `handle-daemon-event-background.test.ts` for the new `ended` payload.
4. **Actions.** Add a new `features/chat/controller/chat-background-actions.ts`
   (host-style, mirroring `chat-actions.ts`).
   - `stopBackgroundTask(host, taskId)` dispatches `stop.requested`, then calls
     `killBackgroundTask(host.getDaemonId(), taskId)`.
   - On `ok`, it arms a 10 s timer. When the timer fires, if the row is still running and
     `stopping`, it dispatches `stop.failed` with "Stop requested, but the task is still
     running."
   - On `not-found`, it dispatches `background.removed`.
   - On `error`, it dispatches `stop.failed` with a readable message that contains the
     daemon's text, for example `Couldn't stop this task: <error>`.
   - `dismissBackgroundTask(host, taskId)` dispatches `background.dismissed`.

   `sendChatMessage` and `retryChatMessage` (`chat-actions.ts`) dispatch
   `background.turn.started` right after the optimistic `run.started`. The controller
   (`acp-chat-controller.ts`) gains one-line delegating methods, and
   `ChatRuntimeExtras`/`buildChatExtras` (`runtime/chat-extras.ts`) expose
   `stopBackgroundTask(taskId)` and `dismissBackgroundTask(taskId)`. *Verify:* action
   tests use a mocked API module and fake timers. They cover:
   - exactly one kill call per activation
   - the ok, then ended, then settled path
   - the ok then 10 s path, which produces the timeout message (AC4)
   - not-found removing the row (AC5)
   - an error whose message contains the daemon text, where a retry sends another kill
     (AC3)
   - a send clearing terminal rows while running rows are untouched

**Group exit:** the types build, `pnpm --filter @qlan-ro/mainframe-ui typecheck` and lint
pass, and the touched UI and types test files pass when run individually.

---

## Group `activity-ui` (ui)

Load the `mainframe-design-system` skill before writing markup. Reuse `Hint`, `PanelCard`,
the tone classes `text-success`/`text-destructive`/`text-muted-foreground`,
`formatRunDuration`/`formatRunTokens` and `useNow`. No new tokens.

1. **Pure view helpers** (`features/session-panel/activity-view.ts`, plus a new
   `activity-kinds.ts` if the file would pass 300 lines).
   - `runningCount` counts entries whose `status` is absent or `'running'`. Stopping rows
     are running records, so they count too.
   - `activityKind(task)` returns `monitor` when `kind === 'bash' && toolName === 'Monitor'`,
     and otherwise returns the kind.
   - Glyph map: agent `Bot`, bash `SquareTerminal`, monitor `Radar`, workflow `Workflow`,
     other `CircleDashed`.
   - Label: `Monitor` for monitor, `Task` for bash, and for `other` the `reportedType`,
     falling back to `Task`.
   - `rowState(task, stop)` returns running, stopping, stop-error or a terminal status.
     A terminal status always wins over stop state.
   - `orderRows` puts running rows first by `startedAt` ascending, then terminal rows by
     `endedAt` descending.
   - `statusTone` gives the tone for each status.

   *Verify:* unit tests cover AC15's count (1 running + 2 terminal gives 1), AC16's
   pairwise-distinct glyphs, the monitor/bash labels, and `other` + `container_exec`
   producing the label `container_exec` (AC17).
2. **Row and trailing slot.** Split `ActivityCard.tsx` into `ActivityRow.tsx` and
   `ActivityTrailingSlot.tsx`. The row is a container `div` with
   `session-panel-task-<id>` and the `group` class. It holds two siblings: a full-width
   `button` with `activity-drill-open-<id>` (glyph `session-panel-kind-<activityKind>`,
   title, second line), and the fixed-width (`size-5`-class) trailing slot. Nested
   buttons are invalid HTML, which is why the controls are siblings.

   | Row state | Trailing slot | Second line |
   |---|---|---|
   | running | elapsed by default; `activity-stop-<id>` (`Square`) on `group-hover`/`focus-within`, always in the tab order | kind label |
   | stopping | spinner, always visible | "Stopping…" |
   | stop-error | `activity-stop-error-<id>`, destructive-tinted square, always visible; `Hint` + `aria-label` carry the message; click retries | kind label |
   | terminal | static total duration; `activity-dismiss-<id>` (`X`) on hover/focus | kind label and status word with tone |

   When the capability is unsupported, `activity-stop-<id>` renders with
   `aria-disabled="true"`, stays focusable, sends nothing, and shows the tooltip
   "Stopping background tasks isn't supported for <adapter name> sessions." The adapter is
   resolved as `ChatGateMount` does, via `useAdapters()` and
   `extras.state.chatConfig?.adapterId`. An unknown adapter counts as unsupported. The
   stop and dismiss controls call `stopPropagation` so they never open the detail view
   (AC2). A workflow row whose run is known keeps `session-panel-workflow-<runKey>` on its
   open button and still opens `WorkflowRunPanel`, including when terminal.
3. **Detail drill-in** (`ActivityDetail.tsx`, `ActivityOutputTail.tsx`,
   `use-output-tail.ts`). In `ActivityCard`, `drillTaskId` now takes any id. It resolves
   in this order: a known workflow run shows `WorkflowDrillIn`; a listed task shows
   `ActivityDetail`; otherwise the list. So a row leaving the list returns to the list,
   and the `chatId` reset effect still covers session switches.
   - `ActivityDetail` has `activity-detail-<id>` and a back button,
     `activity-drill-back-<id>`, labelled "Activity".
   - It shows the full description and full command (wrapping) and the glyph, kind label
     and status tone.
   - It shows the Tool line for bash-kind rows only, the start time, and the elapsed time
     or total duration.
   - It shows "Recovered" when `recovered`, and the reported type for `other`.
   - It shows the summary, last output line and usage only when present.
   - It shows the stop-error message when in stop-error.

   `use-output-tail`:
   - For an agent row: no request. It renders `activity-output-transcript-<id>` with
     "This agent's output is its transcript, which isn't shown here." and no refresh
     (AC22).
   - With no `outputPath`: no request, and it renders `activity-output-none-<id>`.
   - Otherwise it fetches once on open, and on `activity-output-refresh-<id>`.
   - Result states: loading; `activity-output-lines-<id>` (monospace, wrapping, scrolled to
     the end); `activity-output-empty-<id>` for empty text; `-none-`; or `-error-` with
     the message (AC10).
4. **Card wiring and badges.** `ActivityCard` orders rows with `orderRows`. The panel
   count and the `SessionPanelRail` badge, dot and tooltip use the new `runningCount`.
   "Nothing running" appears only when the list is empty. The header comment is updated
   to match: the list now holds terminal rows.
5. **Tests and e2e.** Extend `ActivityCard.test.tsx` and `SessionPanelRail.test.tsx`, or
   add sibling component test files if a file would grow past 300 lines. Cover:
   - AC1: the stop control appears on hover and focus in the same slot
   - AC2/AC3: the state transitions, driven through extras stubs
   - AC7: disabled and focusable with a tooltip, and no call
   - AC9: detail open and back, and a workflow row still opens the run panel
   - AC10 and AC22: the output states
   - AC13: the terminal label and duration
   - AC15: 1 running + 2 terminal shows badge 1 and "1 task running", and dismissing
     leaves the badges unchanged
   - AC16: the monitor and bash rows
   - AC20: testids keyed by task id

   Update `packages/e2e/tests-tauri/session-panel.spec.ts` "a delegated subagent shows one
   running Agent row…". After the second turn the row stays listed as "Completed" with no
   rail dot. `session-panel-activity-empty` appears only after `activity-dismiss-<id>`, or
   after a further user turn clears it.

**Group exit (lane exit):** UI typecheck, lint and the touched test files pass. The group
adds a changeset covering `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui` (they are
a fixed group), minor bump, describing stop, details and terminal rows.

## Risks

- **Parallel wire drift.** `daemon` and `client-state` implement the contract
  independently. Each pins the same literal key sets, so a divergence fails a test on one
  side. The independent review should diff the two key-set tests.
- **Turn-clear signal.** `run.started` is re-dispatched on every `chat.updated` with
  `isRunning: true` and on CLI-initiated turns, so it cannot mark "the next user turn".
  The plan uses the local send and retry. A turn started from another client (mobile) does
  not clear terminal rows; the cap and dismissal still bound them.
- **Dangling-link classification.** `canonicalize` fails with `NotFound` for a dangling
  symlink too. Without the `symlink_metadata` pre-check, a dangling link would be misread
  as `no_output`.
- **Missing tasks directory.** If the CLI creates the tasks directory after
  `task_started`, a brand-new task shows the error state until Refresh (accepted in the
  spec).
- **File size.** `routes/background_tasks.rs` is already 310 lines, and
  `acp-chat-controller.ts` is 296. Add only delegation lines there; put logic in the new
  modules.
- **E2E.** The mock adapter reports stop unsupported, so stop cannot be exercised
  end-to-end with it. Stop is covered by component and action tests. Live QA on a Claude
  session covers AC2 and AC12.

## Established facts

- The output route's success body is raw `text/plain`. Failures use the `fail` envelope
  `{success:false,error}`. Receipt: `mainframe-server/src/routes/background_tasks.rs`
  `output`, and `respond.rs` `fail`.
- The kill route returns 404 `task not found` before calling `kill_background_task`, and
  maps `KillResult::Err` to 502 with the error string. Receipt: `routes/background_tasks.rs`
  `kill`.
- Path validation `canonicalize`s the output path, so an absent file fails exactly like an
  out-of-root path. Receipt: `mainframe-background-tasks/src/spool_validator.rs`
  `MadeSpoolValidator::validate`.
- `kill_background_task` returns `Err { "no live writer" | "no outputPath", via: None }`
  when there is no writer, and ends the task only on OS-signal success. Receipt:
  `kill.rs` `kill_background_task`, `kill_one_task_os`, `OsKillReason`.
- `tracker.end` emits `TaskEvent::Ended`, dedups already-terminal tasks, and stamps
  `ended_at`. Receipt: `tracker.rs` `BackgroundTaskTracker::end`.
- The Claude adapter maps `task_type` to `kind` and discards the raw string. Receipt:
  `mainframe-adapter-claude/src/task_events.rs` `handle_task_started`, `map_task_kind`.
- `tool_name` defaults to `Bash` when no Bash/Monitor tool_use was captured, and Monitor is
  captured only via `capture_tool_use` with `name == "Monitor"`. Receipt: `task_events.rs`
  `capture_tool_use`, `handle_task_started`.
- Recovered tasks are adopted with `kind: Bash` and `recovered: Some(true)`. Receipt:
  `reconcile.rs` (recovered snapshot construction).
- The Codex and Mock sessions' `stop_background_task` return `ok:false, "unsupported"`,
  while Claude sends a stop over stdin. Receipt: `mainframe-adapter-codex/src/session.rs`
  and `mainframe-adapter-mock/src/session_trait.rs` `stop_background_task`;
  `mainframe-adapter-claude/src/session.rs` `ClaudeSession::stop_background_task`.
- The Rust `AdapterCapabilities` is `Copy` with a non-optional `auto_mode: bool`, and TS
  has `autoMode?: boolean`. Receipt: `mainframe-types/src/adapter.rs` `AdapterCapabilities`,
  `packages/types/src/adapter.ts` `AdapterInfo`.
- `Chat.backgroundActivity` is built from running tasks only, via `to_activity_task`.
  Receipt: `mainframe-chat/src/chat_manager/shared.rs` `enrich_chat`.
- `chat.updated` with `isRunning: true` maps to `run.started` on every broadcast, and a
  send dispatches `local.message.queued` then `run.started`. Receipt:
  `features/chat/controller/handle-daemon-event.ts` `handleDaemonEvent`, and
  `chat-actions.ts` `sendChatMessage`, `retryChatMessage`.
- Today the UI deletes a row on any non-running payload or on ended. Receipt:
  `handle-daemon-event.ts` (`background_task.*` cases), and `chat-environment-state.ts`
  `reduceEnvironmentEvent` `background.ended`.
- UI adapter capability lookup follows the pattern `useAdapters()` (`store/adapters.ts`) +
  `extras.state.chatConfig?.adapterId`. Receipt: `features/chat/gates/ChatGateMount.tsx`.
- `lucide-react` 1.25.0 ships the `radar`, `square`, `loader-circle` and `x` icons. Receipt:
  `node_modules/.pnpm/lucide-react@1.25.0_react@19.2.8/.../dist/esm/icons/{radar,square,loader-circle,x}.mjs`.
- `formatRunDuration` and `formatRunTokens` exist. Receipt:
  `features/chat/workflow/workflow-progress.ts`.
- The changesets config makes `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui` a fixed
  group. Receipt: `.changeset/config.json` `fixed`.
- The e2e test "a delegated subagent shows one running Agent row until its result lands"
  asserts the row disappears after the next turn, so it must change. Receipt:
  `packages/e2e/tests-tauri/session-panel.spec.ts` (`§session-panel — Activity card`).
