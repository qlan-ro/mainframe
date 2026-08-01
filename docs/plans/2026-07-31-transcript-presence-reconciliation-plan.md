# Plan — #289: wire transcript-presence reconciliation into the daemon

## Goal

`ChatManagerDeps::is_transcript_present` carries a trait default that returns `None`
("presence cannot be determined"), and the daemon's only production implementation,
`DaemonChatDeps`, silently inherits it. Every reconciliation therefore takes the
"cannot judge" branch: `transcript_missing` is never set and never cleared, the
degraded-chat recovery card has never rendered in production, and the send-path
auto-`continue-here` guard never fires. The same file leaves
`ExternalSessionDeps::reconcile_transcript` at its `None` default, so the periodic
external-session sweep is a no-op too. This plan delegates the load-path predicate to
the registry-resolved adapter, removes the trait default so the compiler rejects a
future omission (#273's precedent), late-binds the sweep callback to
`ChatManager::reconcile_transcript` through a `Weak` back-reference, and adds
wiring-level integration coverage in `mainframe-server` that a hand-built fake could
not have caught. The reconciliation algorithm itself does not change.

## Verified facts this plan rests on

Read before planning; each is load-bearing.

- `ChatManagerDeps::is_transcript_present` default body is at
  `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs:278-286`.
- Only two implementors of `ChatManagerDeps` exist: `DaemonChatDeps`
  (`packages/core-rs/crates/mainframe-server/src/chat_deps.rs:197`) and the test fake
  `StoreDeps` (`packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs:65`).
  **`StoreDeps` already overrides `is_transcript_present` explicitly** (tests.rs:314),
  so removing the default breaks exactly one call site. The brief's "test fakes gain an
  explicit `None`" step is already satisfied and requires no edit.
- `Adapter::is_transcript_present(session_id: String, project_path: String,
  session_file_path: Option<String>) -> BoxFuture<'_, Result<Option<bool>, AdapterError>>`
  lives at `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs:239`, with a
  default `Ok(None)`. `DaemonChatDeps::generate_title` (chat_deps.rs:573-595) is the
  exact delegation shape to mirror: resolve `self.adapters.get(id)`, own the args, log
  `tracing::warn!` on `Err`.
- `build_chat_manager` (chat_deps.rs:812-843) builds `Arc<DaemonChatDeps>`, then
  `ExternalSessionService::new(deps.clone())`, then
  `ChatManager::new(deps).with_external_sessions(service)`. The manager is the last
  thing constructed, so a back-reference must be late-bound.
- `ExternalSessionDeps::reconcile_transcript` default is at
  `packages/core-rs/crates/mainframe-chat/src/external_session_service.rs:57-59`; the
  sweep body that consumes it is `sweep_transcript_presence_impl` (same file, 385-396),
  called from `start_auto_scan`'s initial spawned task (line 194) and its 5-minute
  ticker (line 208).
- `ChatManager::get_display_messages` (chat_manager.rs:1573-1587) calls
  `get_messages` → `history_session` → `deps.create_session`, so a stub adapter
  registered for the test **must** return a real `Arc<dyn AdapterSession>`;
  `unreachable!()` (the shape used in `routes/session_transcripts.rs`) would panic.
  `mainframe_adapter_mock::ReplaySession::new(options, Vec::new())` is public, sets
  `ReplaySource::Ready`, and its `load_history` returns `Ok(vec![])` with no file I/O.
  `mainframe-adapter-mock` is already a non-dev dependency of `mainframe-server`.
- `packages/core-rs/crates/mainframe-server/tests/chat_background_activity.rs` is
  #273's wiring-level regression test and is the structural template for the new one
  (harness over `build_chat_manager`, broadcast polled with a 5s timeout).
- `Db` is `#[derive(Clone)]` (`mainframe-server/src/db.rs:22`), so the harness can keep
  a handle after passing one into `build_chat_manager`.
- The send-path auto-`continue-here` guard already exists (chat_manager.rs:1828-1848)
  and needs no code change — only live verification.
- The UI card is `packages/ui/src/features/chat/thread/DegradedChatCard.tsx`
  (testids `chat-degraded-card`, `-continue`, `-recreate-worktree`, `-project-root`,
  `-delete`), rendered from `ChatThread.tsx:99` off `chatConfig.transcriptMissing`.

## Constraints

- Max 300 lines/file, 50 lines/function. `chat_deps.rs` (1582) and `chat_manager.rs`
  (2158) already exceed this; **do not split them** — #292 owns that refactor and
  rebases on this PR. Keep the diff a wiring fix.
- No silent catches: every `Err` and every unresolved adapter logs via `tracing`.
- New test files must each stay under 300 lines, hence the split into a support module.
- A changeset is required before commit.
- Out of scope: #290 (`adapter_snapshot_models`) stays a separate todo per the
  2026-07-29 brief-gate ruling — leave that default in place. Do not change the
  reconciliation algorithm, any adapter's predicate, or the card's markup/actions.

## Task numbering

| # | Task | # | Task | # | Task |
|---|------|---|------|---|------|
| 1 | A1 | 5 | B2 | 9 | B6 |
| 2 | A2 | 6 | B3 | 10 | C1 |
| 3 | A3 | 7 | B4 | 11 | C2 |
| 4 | B1 | 8 | B5 | 12 | D1 |

---

## Task group A — server wiring regression tests (red phase)

Written and observed failing before any production change exists. Touches only new
files under `packages/core-rs/crates/mainframe-server/tests/`.

### A1. Add the test support module

**File (new):** `packages/core-rs/crates/mainframe-server/tests/transcript_presence_support/mod.rs`

Contents:

- `enum PredicateOutcome { Present, Absent, Error }`.
- `struct StubAdapter { adapter_id: String, outcome: PredicateOutcome, calls: AtomicUsize }`
  implementing `mainframe_adapter_api::Adapter`. Copy the minimal-adapter shape from
  `packages/core-rs/crates/mainframe-server/src/routes/session_transcripts.rs:147-180`
  (`id`/`name`/`capabilities`/`is_installed`/`get_version`/`list_models`/`kill_all`),
  with two differences:
  - `create_session` returns
    `Arc::new(mainframe_adapter_mock::ReplaySession::new(options, Vec::new()))`.
  - `is_transcript_present` increments `calls` and returns `Ok(Some(true))`,
    `Ok(Some(false))`, or `Err(AdapterError::Message("stub predicate failed".into()))`
    per `outcome`.
- `struct Harness { manager: Arc<ChatManager>, db: Db, broadcast: broadcast::Sender<DaemonEvent>,
  project_id: String, chat_id: String, _data_dir: TempDir }`.
- `fn harness(adapter: Option<Arc<StubAdapter>>, seed_missing: Option<bool>) -> Harness`,
  modelled on `chat_background_activity.rs:55-100`:
  - tempdir + `Db::spawn(:memory:)` + `broadcast::channel(64)` + `NoopQuotaSettings`
    (copy from that file — it is 11 lines, and the two test targets cannot share it
    without a support module of their own).
  - create a project at the tempdir path; create a chat with adapter id
    `"stub-adapter"` when an adapter is passed, otherwise `"unregistered-adapter"`.
  - `db.chats.update(chat_id, ChatUpdate { claude_session_id: Some("sess-1"),
    transcript_missing: seed_missing, ..Default::default() })` — reconciliation skips
    a chat with no session id, so this seeding is mandatory.
  - register the adapter into a fresh `AdapterRegistry` before `build_chat_manager`.
  - keep a cloned `Db` so tests can read the persisted row back.
- `fn persisted_missing(h: &Harness) -> Option<bool>` — `db.chats.get(chat_id)` →
  `transcript_missing`.
- `async fn next_chat_updated(rx, timeout) -> Option<Chat>` — drain the broadcast for a
  `DaemonEvent::ChatUpdated`, returning `None` on timeout (used both to assert an
  emission and to assert its absence with a short timeout).

**Verify:** `cargo test -p mainframe-server --test transcript_presence_wiring` compiles
once A2 lands (a bare `tests/<dir>/mod.rs` is not itself a test target).

### A2. Add the wiring test cases

**File (new):** `packages/core-rs/crates/mainframe-server/tests/transcript_presence_wiring.rs`

Module doc comment must state, as `chat_background_activity.rs` does, that this drives
the production stack through `build_chat_manager` and that a unit test against a
hand-built `ChatManagerDeps` fake would not catch the defect.

Cases:

1. `absent_transcript_flips_the_persisted_flag_and_broadcasts` — `PredicateOutcome::Absent`,
   chat seeded with `transcript_missing = None`. Subscribe, call
   `manager.get_display_messages(&chat_id).await`. Assert the payload's
   `transcript_missing == true`, `persisted_missing(&h) == Some(true)`, and a
   `ChatUpdated` event whose `chat.transcript_missing == Some(true)` arrives within 5s.
2. `present_transcript_clears_a_stale_flag` — `PredicateOutcome::Present`, chat seeded
   with `transcript_missing = Some(true)`. Assert payload `false`,
   `persisted_missing == Some(false)`, and one `ChatUpdated` broadcast.
3. `an_unregistered_adapter_id_leaves_the_flag_unchanged` — harness built with no
   adapter registered and chat adapter id `"unregistered-adapter"`, seeded
   `transcript_missing = Some(true)`. Assert payload `true`, `persisted_missing`
   still `Some(true)`, and no `ChatUpdated` within a 200ms window. The test must not
   panic — the missing adapter is a logged warning, not an error.
4. `a_failing_predicate_leaves_the_flag_unchanged` — `PredicateOutcome::Error`, seeded
   `Some(true)`. Same assertions as case 3, plus `adapter.calls == 1` proving the
   predicate was actually consulted.
5. `the_external_session_sweep_reconciles_an_unopened_chat` — `PredicateOutcome::Absent`,
   seeded `None`. Do **not** call `get_display_messages`. Instead
   `manager.external_session_service().expect("service wired").start_auto_scan(&project_id)`,
   then poll `persisted_missing(&h)` every 25ms until it is `Some(true)` or a 5s
   timeout elapses; call `stop_auto_scan(&project_id)` before asserting. The stub
   adapter's id is neither `claude` nor `codex`, so `external_session_adapter_ids`
   returns empty and the co-scheduled `emit_count` scan is a no-op.

**Verify:** `cargo test -p mainframe-server --test transcript_presence_wiring` — cases
1, 2, 4 and 5 fail; only case 3 passes trivially and must be re-confirmed as still
passing after group B. Case 4 fails in the red phase on `adapter.calls == 1`, not on
the flag: until B2 lands, `DaemonChatDeps` inherits the trait default
(`chat_manager.rs:278-286`), which returns `None` without touching `self.adapters`, so
the stub's predicate is never invoked and `calls == 0`. Keep that assertion — it is the
only thing separating "predicate consulted and errored" from "predicate never reached".
Record the failure output.

### A3. Confirm the pre-existing suites are green

**Verify:** `cargo test -p mainframe-chat` and
`cargo test -p mainframe-server --test chat_background_activity` both pass unchanged.

---

## Task group B — daemon deps wiring (green phase)

Depends on group A: these tasks are complete only when A2's five cases pass.

### B1. Make `is_transcript_present` required

**File:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs` (lines 276-286)

Delete the default body, leaving a bare signature with un-underscored parameter names.
Replace the doc comment with one that records the decision in the same voice as
`tracker_list_live` (chat_manager.rs:260-264): required, not defaulted, because an
implementation that silently inherited `None` left degraded-chat detection inert in
production (#289, same class as #273).

**Verify:** `cargo check -p mainframe-chat` passes (`StoreDeps` already overrides it);
`cargo check -p mainframe-server` now FAILS on `DaemonChatDeps` — that failure is the
proof the compiler gate works. Record it, then continue to B2.

### B2. Implement the predicate on `DaemonChatDeps`

**File:** `packages/core-rs/crates/mainframe-server/src/chat_deps.rs` — inside
`impl ChatManagerDeps for DaemonChatDeps`, adjacent to `generate_title` (line 573).

```rust
fn is_transcript_present<'a>(
    &'a self,
    adapter_id: &'a str,
    session_id: &'a str,
    project_path: &'a str,
    session_file_path: Option<&'a str>,
) -> BoxFuture<'a, Option<bool>> {
    let adapter = self.adapters.get(adapter_id);
    let (session_id, project_path) = (session_id.to_string(), project_path.to_string());
    let session_file_path = session_file_path.map(str::to_string);
    Box::pin(async move {
        let Some(adapter) = adapter else {
            tracing::warn!(adapter_id, "transcript presence: no adapter registered");
            return None;
        };
        match adapter
            .is_transcript_present(session_id, project_path, session_file_path)
            .await
        {
            Ok(present) => present,
            Err(err) => {
                tracing::warn!(%err, adapter_id, "transcript presence check failed");
                None
            }
        }
    })
}
```

The caller already resolves worktree-over-project path (`transcript_presence.rs:71`),
so pass `project_path` through untouched.

**Verify:** `cargo check -p mainframe-server`;
`cargo test -p mainframe-server --test transcript_presence_wiring` — cases 1-4 pass,
case 5 still fails.

### B3. Add the late-bound manager back-reference

**File:** `packages/core-rs/crates/mainframe-server/src/chat_deps.rs`

- Add to `struct DaemonChatDeps` (line 119): `chat_manager: OnceLock<Weak<ChatManager>>`,
  with a one-line comment naming the reason (`Weak`, set after construction, because the
  manager is built from these deps). Import `std::sync::{OnceLock, Weak}`.
- In `build_chat_manager` (line 828), initialize the field to `OnceLock::new()`, pass
  `deps.clone()` to `ChatManager::new`, bind the result, then
  `let _ = deps.chat_manager.set(Arc::downgrade(&manager));` and return `manager`.
- Update the `test_deps()` struct literal in the `#[cfg(test)]` module (chat_deps.rs
  ~line 1316) with the new field.

**Verify:** `cargo test -p mainframe-server --lib chat_deps` passes.

### B4. Wire the sweep callback

**File:** `packages/core-rs/crates/mainframe-server/src/chat_deps.rs` — inside
`impl ExternalSessionDeps for DaemonChatDeps` (line 683).

```rust
fn reconcile_transcript<'a>(&'a self, chat: &'a Chat) -> Option<BoxFuture<'a, bool>> {
    let manager = self.chat_manager.get()?.upgrade()?;
    let mut chat = chat.clone();
    Some(Box::pin(async move { manager.reconcile_transcript(&mut chat).await }))
}
```

The clone is deliberate: the sweep discards its `Chat` copy, and reconciliation persists
the flag plus syncs the active-chat cache through the deps, so nothing is lost. Keep the
`Option` return shape — harnesses with no manager legitimately yield `None`.

**Verify:** `cargo test -p mainframe-server --test transcript_presence_wiring` — all five
cases pass.

### B5. Correct the stale ledger notes

Both `// PORT STATUS` blocks assert the current, now-wrong state.

- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs:2148-2153` — drop
  `#289 is_transcript_present` from the "still silently unoverridden" list (keep #290),
  and add `is_transcript_present` to the required-not-defaulted sentence. Adjust the
  `todos:` count on that ledger accordingly.
- `packages/core-rs/crates/mainframe-server/src/chat_deps.rs:1580-1582` — replace the
  "`reconcile_transcript` is left at the trait's own `None` default … the sweep is a
  no-op" paragraph with the wiring as built (weak back-reference set in
  `build_chat_manager`). Adjust that ledger's `todos:` count.

**Verify:** `rg -n "is_transcript_present" packages/core-rs/crates/mainframe-chat/src/chat_manager.rs
packages/core-rs/crates/mainframe-server/src/chat_deps.rs` shows no remaining claim that
the method is defaulted or unoverridden.

### B6. Full gate

**Verify, all from `packages/core-rs`:**
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test -p mainframe-chat`
- `cargo test -p mainframe-server`

---

## Task group C — changeset and defaults audit

Depends on group B.

### C1. Changeset

**File (new):** `.changeset/transcript-presence-reconciliation.md`, bumping
`'@qlan-ro/mainframe-app-tauri': patch` (the shape #273 used in
`.changeset/background-activity-live-set.md`). Describe the user-visible effect — a
session whose CLI transcript was deleted now shows the recovery card and resets its dead
session before the next send — not the trait mechanics.

**Verify:** `pnpm changeset status` runs clean.

### C2. Read-only audit of remaining defaulted deps methods

No code changes. List every method on `ChatManagerDeps` and `ExternalSessionDeps` that
still carries a trait default, and mark each as (a) legitimately optional, or (b) a
production implementation is missing. `adapter_snapshot_models` is already filed as #290
— name it and move on. File anything new as its own todo; do not fix it here.

**Verify:** the list appears in the PR description, and every (b) entry has a todo number.

---

## Task group D — live verification

Depends on group B. No file changes expected; a visual defect gets filed separately per
the todo's out-of-scope ruling.

### D1. Confirm the degraded card and the send-path reset in the running app

Run the Tauri dev app with an isolated data dir and port (`MAINFRAME_DATA_DIR` +
`DAEMON_PORT` — an unisolated launch hijacks :31415 and the real `~/.mainframe`).

**Scope: the transcript-missing path only.** `chat-degraded-project-root` and
`chat-degraded-recreate-worktree` render only under `worktreeMissing`
(`DegradedChatCard.tsx:106` and `:95`), which a transcript-only scenario never sets;
`continue_in_project_root` would in any case reject with
`DegradedRecoveryError::NoWorktree` (`degraded_recovery.rs:130-132`). That flag comes
from the pre-existing worktree check (`chat_manager.rs:389`), already live in
production and untouched here, so those two actions are out of D1's scope.

Each degraded action is terminal for the card: `continue_here` clears the session and
the `transcript_missing` flag (`degraded_recovery.rs:112-123`), so the card unmounts
(`DegradedChatCard.tsx:38`). Every click below therefore gets its own freshly seeded
chat — do not chain clicks on one chat.

Seeding a degraded chat means: open a Claude session with real history, note its session
id, stop the CLI, delete its transcript under `~/.claude/projects/…`, reload the chat.

1. Seed chat A. Assert `chat-degraded-card` renders with the "Transcript deleted" cause
   and exactly two actions, `chat-degraded-continue` and `chat-degraded-delete`. Check
   its type scale, spacing, and destructive-tone usage against the
   `mainframe-design-system` skill — this card has never rendered in production for the
   transcript cause, so its live appearance is unverified.
2. Restore chat A's transcript file, reload, and confirm the card disappears
   (self-healing).
3. Delete chat A's transcript again, reload, click `chat-degraded-continue`. Confirm the
   card unmounts and the db row's `claude_session_id` and `transcript_missing` are both
   cleared.
4. Seed chat B, click `chat-degraded-delete`, and confirm the chat leaves the sidebar
   (archived with its worktree).
5. Seed chat C but leave no live CLI, then send a message without touching the card.
   Confirm the daemon logs the `continue-here` reset and spawns a fresh session rather
   than resuming the dead id.
6. Seed chat D and leave it closed, then wait for the sweep (or restart the daemon to
   trigger `start_auto_scan`'s initial pass) — its sidebar row should pick up the
   degraded marker without ever being opened.

**Verify:** each step's outcome recorded in the PR description; any visual defect filed
as a new todo rather than fixed here.
