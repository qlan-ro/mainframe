# Plan — todo #273: live background activity never reaches the client

**Todo:** #273 (project `rgoM5ZldH0UeeOonms6PK`) · **Route:** no-spec · **Branch:** `todo/273-background-activity-live`
**Worktree:** `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-273-background-activity-live`

## Goal

The Rust daemon's production `ChatManagerDeps` implementation, `DaemonChatDeps`, never overrides
`tracker_list_live`, so the trait's empty default wins and every chat enrichment path sees "no
background work". `Chat.backgroundActivity` is therefore always absent and `Chat.displayStatus` never
widens to `working` on background-only activity — the above-composer pill never appears and the
session row shows no in-progress state, for agents, bash tasks, and workflows alike. This change adds
the missing override so enrichment reads the real tracker, deletes the trait's empty default so the
next implementation cannot repeat the omission silently, and adds wiring-level tests that exercise the
production deps through `build_chat_manager` rather than calling the private `enrich_chat` helper — the
gap that let the regression ship. No UI change: the client already resyncs its live set from
`chat.backgroundActivity` on every `chat.updated`.

## Verified against the code

Line numbers are from this branch at `5f7fdcaa`; they differ from the ones quoted in the todo body.

| Fact | Location |
| --- | --- |
| `tracker_list_live` declared with an empty default | `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs:256-260` |
| `DaemonChatDeps` overrides `tracker_remove_chat` but not `tracker_list_live` | `packages/core-rs/crates/mainframe-server/src/chat_deps.rs:665-667` |
| `DaemonChatDeps` already holds `background_tasks: Arc<BackgroundTaskTracker>` | `packages/core-rs/crates/mainframe-server/src/chat_deps.rs:121` |
| `enrich_chat` derivation (correct as written) | `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs:367-387` |
| Broadcast enrichment path | `enrich_and_emit`, `chat_manager.rs:390-406` |
| Read/refresh enrichment paths | `get_chat` `:1158`, `list_chats` `:1173`, `list_all_chats` `:1190`, `list_filtered` `:1407` |
| Only two `impl ChatManagerDeps` in the workspace | `chat_deps.rs:196` (production), `chat_manager/tests.rs:53` (`StoreDeps`) |
| `BackgroundTaskTracker::list_live` filters `status == Running` | `packages/core-rs/crates/mainframe-background-tasks/src/tracker.rs:224-229` |
| Production assembly entry point (public, usable from an integration test) | `build_chat_manager`, `chat_deps.rs:803-833` |
| `ChatManager::new` calls `idle_scanner.start()` → `tokio::spawn` | `chat_manager.rs:1077-1078`, `idle_scanner.rs:68` |
| UI resyncs from `chat.backgroundActivity` on every broadcast | `packages/ui/src/features/chat/controller/chat-event-router.ts:42-44` |
| UI resyncs on subscribe/select from the fetched chat | `packages/ui/src/features/chat/controller/chat-thread-controller.ts:212` |

## Constraints

- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` must pass (`.github/workflows/rust-port.yml:28,31`).
- New files stay under 300 lines; new functions under 50. `chat_deps.rs` (1550 lines) and
  `chat_manager.rs` (2338) are pre-existing over-limit files — this change adds 5 and removes 3 lines
  respectively, and must not grow them further. That is why the new tests live in their own file.
- Changeset required. Daemon-side fixes post-cutover bump `@qlan-ro/mainframe-app-tauri: patch`
  (precedent: `.changeset/setup-advisor-engine.md`).
- TDD: the test task lands first and must be observed failing before the fix task.

## Decisions

- **D1 — The wiring tests live in a new integration test file, not in `chat_deps.rs`'s `#[cfg(test)]`
  module.** `chat_deps.rs` is already 5× the 300-line limit; the acceptance criteria forbid growing a
  file past the limit as a result of this change, and an integration test that drives the real
  `build_chat_manager` output is a truer wiring test than a unit module poking private fields.
- **D2 — The pending-permission precedence case (acceptance criterion 5) stays at the `enrich_chat`
  unit level**, where `chat_manager/tests.rs:1083` already asserts it. `ChatManager` exposes no public
  way to enqueue a pending permission; one arrives only through a live session's `control_request` via
  the `EventHandler`. Faking that would mean standing up a fake `AdapterSession` and driving a control
  request purely to re-assert a branch that is not on the regression's seam. The regression is the
  tracker read, and the tracker read is covered at the wiring level.
- **D3 — Two sibling methods with the same silent-default defect are reported, not fixed.**
  `is_transcript_present` (`chat_manager.rs:270-277`, default `None`) and `adapter_snapshot_models`
  (`chat_manager.rs:281-286`, default empty) are also declared with defaults and also never overridden
  by `DaemonChatDeps`, so in production the transcript-presence predicate always answers "cannot
  determine" and the lifecycle's default-model normalization always sees an empty catalog. Making them
  required would force implementing both, which is a different change with its own behavior surface.
  Filed as findings for the orchestrator (see "Findings to file separately").

## Tasks

### Task 1 — Wiring-level regression tests (RED)

**File (new):** `packages/core-rs/crates/mainframe-server/tests/chat_background_activity.rs`

Build the production stack through `build_chat_manager` with a real `BackgroundTaskTracker` the test
retains, then assert enrichment on both the broadcast path and the read/refresh paths. The test must
not construct the live-task vec by hand and must not call `enrich_chat`.

Harness (one `fn`, under 50 lines, plus a `struct Harness`):

```rust
struct Harness {
    manager: Arc<ChatManager>,
    tracker: Arc<BackgroundTaskTracker>,
    broadcast: broadcast::Sender<DaemonEvent>,
    project_id: String,
    chat_id: String,
    _data_dir: TempDir,
}
```

- `Db::spawn(|| DatabaseManager::open(Path::new(":memory:")))`, mirroring
  `tests/support/mod.rs:70`.
- `tokio::sync::broadcast::channel::<DaemonEvent>(64)`; keep the sender in the harness and
  `subscribe()` per test.
- `tracker = Arc::new(BackgroundTaskTracker::new())`, passed to `build_chat_manager` and kept.
- Remaining args: `Arc::new(AdapterRegistry::new())`,
  `Arc::new(AttachmentStore::new(data_dir.path().join("attachments")))`, `Arc::new(PushService::new())`,
  `GitFactory`, `Arc::new(NoopLaunchStopper)`, `Arc::new(NoopScopeTunnelStopper)` (both from
  `mainframe_server::chat_seams`), a `QuotaManager` over a local no-op `QuotaSettingsStore` (copy the
  12-line `NoopQuotaSettings` shape from `chat_deps.rs:1283-1293`), and
  `ResolvedPath::from_value("/usr/bin:/bin")`.
- Seed rows through the Db actor. `ProjectsRepository::create` takes `&str`, not `&Path`
  (`packages/core-rs/crates/mainframe-db/src/projects.rs:67`), and the closure must be `'static`, so
  move an owned `String` in: `let path = data_dir.path().to_string_lossy().into_owned();` then
  `db.call_blocking(move |d| d.projects.create(&path, None))`, then
  `db.call_blocking(move |d| d.chats.create(&project_id, "claude", None, None, None))` with an owned
  `project_id` clone.
- Tests are `#[tokio::test]` — `ChatManager::new` starts the idle scanner with `tokio::spawn` and
  panics outside a runtime. `Db::call_blocking` is safe to call from the test task because the DB actor
  owns its own OS thread.

Task-seeding helper:

```rust
fn seed(h: &Harness, id: &str, kind: BackgroundWorkKind, description: &str) {
    h.tracker.start(
        &h.chat_id,
        TaskSeed {
            id: id.to_string(),
            kind,
            tool_name: BackgroundTaskToolName::Monitor,
            tool_use_id: format!("tu-{id}"),
            command: "cmd".to_string(),
            description: description.to_string(),
        },
        format!("/tmp/mf-273-{id}.log"),
    );
}
```

Cases:

1. `chat_updated_broadcast_carries_background_activity_for_every_kind`
   Seed three running tasks — `BackgroundWorkKind::Agent` ("reviewer"), `Bash` ("dev server"),
   `Workflow` ("deploy"). Subscribe, call `manager.rename_chat(&chat_id, "renamed")`, then read events
   until the first `DaemonEvent::ChatUpdated`. Wrap that receive loop in
   `tokio::time::timeout(Duration::from_secs(5), …)` and `.expect("chat.updated within 5s")` — a RED
   run must fail on an assertion or a timeout, never hang the suite. Assert on its `chat`:
   `background_activity` is `Some`; `total == 3`; `by_kind` equals
   `{Agent: 1, Bash: 1, Workflow: 1}`; the three task ids are present (sort before comparing — the
   tracker stores tasks in a `HashMap`, so order is not stable); `display_status == Some(Working)`;
   `is_running == Some(false)`.
2. `read_paths_enrich_background_activity`
   Seed one running `Workflow` task. Assert the same `background_activity.total == 1`,
   `display_status == Some(Working)` and `is_running == Some(false)` on all four read call sites:
   `manager.get_chat(&chat_id)`, `manager.list_chats(&project_id)`,
   `manager.list_all_chats()`, and `manager.list_filtered(Some(&project_id), None, false, false)`.
   Use a local `fn assert_live(chat: &Chat, total: u32)` so the test body stays under 50 lines.
3. `ended_tasks_drop_out_of_the_live_set`
   Assert first with no tasks: `get_chat` yields `background_activity == None`,
   `display_status == Some(Idle)`, `is_running == Some(false)`. Then seed one `Agent` task, assert it
   appears, then `tracker.end(&chat_id, "a-1", TerminalUpdate { status: BackgroundTaskStatus::Completed,
   output_path: …, summary: String::new(), usage: None })` and assert `get_chat` is back to
   `background_activity == None` and `display_status == Some(Idle)`.

Top of file: `#![allow(clippy::unwrap_used, clippy::expect_used)]`, matching `tests/support/mod.rs:5`.

**Verify:**
```
cd packages/core-rs && cargo test -p mainframe-server --test chat_background_activity
```
All three cases must FAIL on assertions (not compile errors) before Task 2. Record the failure output
in the implement-stage notes.

---

### Task 2 — Override `tracker_list_live` and make it required (GREEN)

**File:** `packages/core-rs/crates/mainframe-server/src/chat_deps.rs`
Add the import `use mainframe_types::background_task::BackgroundTask;` (the file currently imports only
`mainframe_types::chat::…`), and add the override immediately after `tracker_remove_chat`
(`:665-667`), mirroring it:

```rust
    fn tracker_list_live(&self, chat_id: &str) -> Vec<BackgroundTask> {
        self.background_tasks.list_live(chat_id)
    }
```

**File:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`
Replace the defaulted declaration at `:256-260` with a required one and re-point the doc comment:

```rust
    /// `tracker.listLive(chatId)` — live (running) background tasks, for enrichChat's
    /// backgroundActivity + widened working state. Required, not defaulted: an
    /// implementation that silently inherited an empty default blanked
    /// backgroundActivity for every chat (#273).
    fn tracker_list_live(&self, chat_id: &str) -> Vec<BackgroundTask>;
```

**File:** `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`
`StoreDeps` no longer compiles without the method. Add `use mainframe_types::background_task::BackgroundTask;`
to the file's imports (the `background_activity` submodule imports it locally; the outer module does
not) and add the explicit empty implementation next to `tracker_remove_chat` (`:280`):

```rust
    /// Empty on purpose: mainframe-server's chat_background_activity test covers the wiring (#273).
    fn tracker_list_live(&self, _chat_id: &str) -> Vec<BackgroundTask> {
        Vec::new()
    }
```

Keep the comment to that one sentence. The brief requires an explicit reason on any implementation
that previously relied on the default; the repo's comment rule caps it at one line.

**Verify:**
```
cd packages/core-rs
cargo test -p mainframe-server --test chat_background_activity   # now green
cargo test -p mainframe-chat background_activity                 # existing 5 enrich_chat cases still green
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

---

### Task 3 — Refresh the PORT STATUS notes

`chat_manager.rs` carries a trailing `// notes:` block that documents the broken state; leaving it is
a stale-comment leftover.

**File:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs` (trailing notes block,
`:2333-2337`)
The line `New defaulted ChatManagerDeps methods (chat_deps.rs must override): tracker_list_live,
is_transcript_present, chats_clear_session/worktree, adapter_snapshot_models` must drop
`tracker_list_live` from the defaulted list and state that it is now required, so the reminder no
longer claims a default that does not exist. In the same block, extend
`Ported: chat-manager-background-activity (5, via direct enrich_chat)` to record that the production
wiring is covered by `mainframe-server`'s `chat_background_activity` integration test.

Leave `chat_deps.rs`'s trailing notes block alone. Nothing in it misdescribes `tracker_list_live`, and
that file is already 5× the line limit — adding a note there would be growth for its own sake.

Do not touch the `reconcile_transcript`, `is_transcript_present`, or `adapter_snapshot_models` notes
beyond removing `tracker_list_live` from the shared list — see D3.

**Verify:** `cd packages/core-rs && cargo fmt --check`, then re-read the `chat_manager.rs` notes block;
no sentence should still describe `tracker_list_live` as defaulted or unwired.

---

### Task 4 — Changeset

**File (new):** `.changeset/background-activity-live-set.md`

```
---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix live background work never showing in a session. The daemon never asked its
background-task tracker which tasks were running, so the pill above the composer
stayed empty and the session row showed no in-progress state while agents, bash
tasks, or workflows ran. This was reported against a workflow because a workflow
runs longest, but it affected every kind of background work.
```

**Verify:** `git status` shows the file; `head -4 .changeset/background-activity-live-set.md` matches
the frontmatter above.

---

### Task 5 — Confirm the UI needs no change (read-only)

Read, do not edit:
- `packages/ui/src/features/chat/controller/chat-event-router.ts:42-44` — resyncs
  `background.snapshot` from `event.chat.backgroundActivity?.tasks ?? []` on every `chat.updated`.
- `packages/ui/src/features/chat/controller/chat-thread-controller.ts:212` — same resync from the
  fetched chat on subscribe/select.
- `packages/ui/src/features/chat/composer/BackgroundActivityBar.tsx` — renders
  `composer-background-activity` with a per-task `composer-background-activity-item-<id>`.

**Verify:**
```
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-event-router-background-snapshot.test.ts
```
Green with no source edit confirms the client contract. If any of the three files turns out to need a
change, stop and report it as a separate finding — it is explicitly out of scope.

## QA stage (not part of the implement groups)

Manual end-to-end check against a dev daemon built from this branch, with an isolated data dir and
port (`MAINFRAME_DATA_DIR` + `DAEMON_PORT`; never launch against `:31415` / `~/.mainframe`):

1. Start a session and have the agent launch a background agent or a long-running bash task.
2. The pill above the composer (`composer-background-activity`) appears with the right kind icon and
   count, and one `composer-background-activity-item-<id>` per live task.
3. Send another message so more `chat.updated` broadcasts land. The pill stays visible — it is not
   wiped by the snapshot resync. This is the specific symptom the empty live set caused.
4. The session row in the sidebar reads in-progress while the background work runs and the main turn
   is idle.
5. Reload the app: the pill and the session row come back from the fetched chat list, not only from
   live `background_task.*` events.
6. When the background work ends, both clear.

## Findings to file separately (do not fix here)

1. `is_transcript_present` (`chat_manager.rs:270-277`) is defaulted to `None` and never overridden by
   `DaemonChatDeps` — same silent-default class as this bug. In production the transcript-presence
   predicate always answers "cannot determine".
2. `adapter_snapshot_models` (`chat_manager.rs:281-286`) is defaulted to an empty vec and never
   overridden by `DaemonChatDeps`, so the lifecycle's default-model normalization always sees an empty
   catalog.
3. The two defects already named in the todo brief: the `spool_root()` uid stub
   (`packages/core-rs/crates/mainframe-background-tasks/src/spool_root.rs:11-14`) and the unverified
   `task_updated` status-field read (`packages/core-rs/crates/mainframe-adapter-claude/src/events.rs:169-173`).

## Task groups

| Group | Kind | Tasks | Files | Parallel-safe |
| --- | --- | --- | --- | --- |
| `wiring-test` | test | 1 | `packages/core-rs/crates/mainframe-server/tests/chat_background_activity.rs` | No — must land and be seen failing before `deps-fix` |
| `deps-fix` | core | 2, 3, 4, 5 | `chat_deps.rs`, `chat_manager.rs`, `chat_manager/tests.rs`, `.changeset/background-activity-live-set.md` | No — depends on `wiring-test` |

The two groups share no files, but the TDD order is a hard dependency in both directions: `wiring-test`
can only be verified RED while the default is still in place, and `deps-fix` can only be verified GREEN
once the test exists. Run them in sequence.

## Definition of done

- [ ] `cargo test -p mainframe-server --test chat_background_activity` green (was red before Task 2).
- [ ] `cargo test -p mainframe-chat` green, including the five existing `background_activity` cases.
- [ ] `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` clean.
- [ ] `tracker_list_live` has no default on the trait; omitting it is a compile error.
- [ ] Changeset present.
- [ ] No file newly exceeds 300 lines; no new function exceeds 50.
- [ ] `chat-event-router-background-snapshot.test.ts` green with no UI source change.
- [ ] All six QA steps run and recorded: pill appears with the right kind and count; pill survives
      later `chat.updated` broadcasts; the sidebar row reads in-progress on background-only work;
      a reload restores both from the fetched chat list; both clear when the work ends.
