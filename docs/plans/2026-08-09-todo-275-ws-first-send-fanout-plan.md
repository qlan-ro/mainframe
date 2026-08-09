# Todo #275 — Deliver a chat's events to the connection that sent the message

**Branch:** `todo/275-ws-first-send-fanout` · **Worktree:** `.worktrees/todo-275-ws-first-send-fanout`
**Route:** no-spec (works from the approved Agent Brief on todo #275)
**Base:** `c470bb1f`

## Goal

The daemon's WebSocket fan-out decides delivery from per-connection chat membership read at emit time, and only the
`subscribe` frame ever writes that membership. `handle_message_send` calls `ChatManager::send_message` without
registering the sending connection, so every chat-scoped event emitted between a client's `message.send` and its
`subscribe` — including the `message.added` and `display.messages.set` for the client's own user message — is dropped
for the one connection guaranteed to care about it. Nothing replays them. This plan registers the sender as a
subscriber of the target chat at the top of `handle_message_send`, before the chat-manager seam check and independent
of the send's outcome, and pins the behavior with four real-socket integration tests: the send-then-subscribe window is
delivered, subscribe-then-send still delivers exactly once, `unsubscribe` releases implicitly gained membership, and an
unrelated chat's events stay withheld while connection-global and `chatId`-less events still reach everyone. The fix is
about five lines in `websocket.rs`; the tests are a new file. No new frame type, no new field, no schema change, no UI
change.

## Findings that shape the plan (verified in this worktree at `c470bb1f`)

1. **The defect is where the brief says it is, at new line numbers.** `handle_message_send`
   (`packages/core-rs/crates/mainframe-server/src/websocket.rs:504-528`) takes `ctx`, `out_tx` and the message fields,
   goes straight to the `ctx.chat_manager` seam check and `cm.send_message(...)`, and never touches `subscriptions`.
   The only writers of the set are the `Subscribe` arm (`:431`) and the `Unsubscribe` arm (`:465`).
2. **The membership test is exactly the three-branch rule the brief describes.** `fanout` (`:650-679`) delivers when the
   type is in `CONNECTION_GLOBAL_EVENT_TYPES` (`:51-55`), or the serialized event has no `chatId`, or
   `handle.subscriptions` contains the `chatId`. `subscriptions` is the same `Arc<Mutex<HashSet<String>>>` the
   connection task holds (`:346-353`), so a write from the frame handler is visible to the pump immediately.
3. **Frames are handled strictly serially.** `handle_socket`'s `select!` awaits `handle_text(...)` inline (`:379`), so
   the connection task cannot read the `subscribe` frame while `message.send` is still in `send_message`. This is both
   the cause of the window and the mechanism the tests use to synchronize (D3).
4. **`message.added` and `display.messages.set` are chat-scoped and not global.** `DaemonEvent::MessageAdded` and
   `DaemonEvent::DisplayMessagesSet` (`packages/core-rs/crates/mainframe-types/src/events.rs:140-164`) both serialize a
   top-level `chatId`, and neither type name appears in `CONNECTION_GLOBAL_EVENT_TYPES`.
5. **The brief's test Decision rests on a false premise.** It states the crate has *"no WebSocket integration harness
   (no integration-test directory in the server crate, no WS client dependency)"* and therefore treats a real-socket
   test as needing *"a new workspace dev-dependency"*. Both halves are false in this tree:
   `packages/core-rs/crates/mainframe-server/tests/support/mod.rs` (397 lines) is a hand-rolled RFC-6455 client
   (`WsClient::connect/send_json/read_event/wait_for/assert_absent`) plus `spawn_test_server`, which boots `build_app`
   on an ephemeral port, calls `spawn_broadcast_pump`, and exposes the live `Arc<AppCtx>` as `TestServer::ctx`. No WS
   crate is involved, so no dependency is added. See D1.
6. **The crate already tests this exact defect class at the socket level.**
   `packages/core-rs/crates/mainframe-server/tests/ws_integration.rs:216-256` holds
   `connection_global_event_reaches_unsubscribed_client` and `chat_scoped_event_withheld_from_unsubscribed_client`:
   both connect a `WsClient`, publish a `DaemonEvent` on `server.ctx.broadcast`, and assert with `wait_for` /
   `assert_absent`. That is the idiom this plan's tests extend.
7. **`chat_manager` is `None` in every test harness.** Both `AppCtx::test_ctx()`
   (`packages/core-rs/crates/mainframe-server/src/ctx.rs:225-264`) and `spawn_test_server` (`tests/support/mod.rs:88`)
   set `chat_manager: None`, so `handle_message_send` warns once and returns without emitting anything. The tests
   therefore publish the window's events on `ctx.broadcast` themselves; what is under test is the membership the frame
   handler registers, not `ChatManager`'s emit sequence, which needs no change.
8. **`websocket.rs` is 832 lines — already over the 300-line limit, before this change.** See D4.
9. **The CI gates for the Rust workspace** (`.github/workflows/rust-port.yml:26-38`, run from `packages/core-rs`):
   `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, then `tools/verify-gate.sh`. The
   forbidden-pattern gate exempts any file whose path contains a `tests` component
   (`packages/core-rs/tools/verify_gate.py:182`), so `.unwrap()` / `.expect()` / `panic!` in the new integration test
   are allowed exactly as they are in `ws_integration.rs`.
10. **The changeset target for a daemon-only behavior fix is `@qlan-ro/mainframe-app-tauri`.** Empty changesets in the
    tree (`.changeset/full-shirts-find.md`, `agent-qa-scripts-rust-daemon.md`, `rust-daemon-pure-rust-search.md`,
    `automations-v2-rust-engine.md`) all cover no-behavior-change refactors or work gated behind
    `MAINFRAME_DAEMON_IMPL`. The one shipped Rust-daemon *behavior* fix with a changeset,
    `.changeset/transcript-presence-reconciliation.md`, bumps `'@qlan-ro/mainframe-app-tauri': patch` — the package
    that bundles the daemon sidecar. `@qlan-ro/mainframe-core`, the alternative named in older plans, was deleted in
    `dfd6aa8d`. `.changeset/config.json` locksteps only `mainframe-types` + `mainframe-ui`, so app-tauri bumps alone.

## Design decisions

- **D1 — Test at the real socket, not at the handler.** The brief's Decision picks handler-level tests because it
  believes a real-socket test costs a new dev-dependency. Finding 5 shows it costs nothing: the harness exists and is
  dependency-free. Criterion 5's actual requirement — "use the crate's existing idioms rather than inventing a parallel
  one" — points the same way, because finding 6 shows the existing idiom for broadcast-gating assertions *is* the
  socket-level test. The real-socket route also satisfies criterion 1 literally ("drives the real app ordering on a
  single connection") and needs no access to private items. **This is a deliberate deviation from the brief's
  Decisions section and must be called out in the PR description.**
- **D2 — Register inside `handle_message_send`, not in the `match` arm.** The brief requires registration "at the start
  of this handler … before the chat-manager seam check". Passing `subscriptions` into the handler keeps the guarantee
  attached to the function a future reader will inspect, and keeps it from being lost if the arm is ever refactored.
  Seven parameters is under clippy's `too_many_arguments` threshold of eight.
- **D3 — Every test synchronizes with a sentinel-subscribe barrier.** `message.send` answers nothing on the success
  path, so a test cannot know the daemon has handled it. Frames are serial on one task (finding 3), so a reply to a
  *later* frame proves the earlier frame's handler already ran: subscribe a throwaway chat id and read until its
  `subscribe:ack`. Only then publish on `ctx.broadcast`. Without the barrier the tests race the frame handler and flake
  in both directions. The barrier's *why* is written into the test file so nobody "simplifies" it away.
- **D4 — Do not split `websocket.rs`; keep the diff minimal.** The brief's "all touched files stay under 300 lines"
  cannot be met for a file that is 832 lines before this change (finding 8), and splitting it is a refactor of the same
  class as todo #292's `chat_manager.rs` split — which the repo treated as its own todo, plan and PR. Growing it is
  what this plan avoids: the fix adds about five lines and every new line of test code lands in a new file that is
  itself under 300. **File a follow-up todo for the `websocket.rs` split** so the deviation is tracked rather than
  ignored; note it in the PR description.
- **D5 — Nothing else gains implicit membership.** `permission.respond` also carries a `chatId` and also never
  registers, but the brief scopes this todo to `message.send` and the permission path is already reachable only after a
  subscription in every shipped client. Do not widen it here, and do not widen `CONNECTION_GLOBAL_EVENT_TYPES`.
- **D6 — Accept unbounded-per-connection membership growth.** A connection that sends to many chats accumulates
  membership for all of them until it `unsubscribe`s or disconnects. That is the brief's accepted semantic; the set is
  connection-scoped and dropped with the socket, and every entry is a chat the client demonstrably interacted with.
- **D7 — Changeset: `'@qlan-ro/mainframe-app-tauri': patch`,** per finding 10. Not empty: this changes shipped daemon
  behavior on every client, even though no user-visible symptom is known today (the todo's 2026-08-09 investigation
  found desktop repairs the drop and mobile avoids it by frame ordering).

## Rules every task follows

1. Work only in `.worktrees/todo-275-ws-first-send-fanout` on `todo/275-ws-first-send-fanout`. Never commit to `main`.
2. Rust commands run from `packages/core-rs`.
3. Every task ends green on its own gate before its commit. The full CI gate set is finding 9.
4. Do not touch `packages/mobile`, the UI, `ws_schemas.rs`, or `mainframe-types`. This change introduces no new frame,
   field, or route.
5. Stage only the files the task names.

---

## Task 1 — Red-phase: the four fan-out membership tests

**Group:** `ws-fanout-tests` (kind `test`) · **Depends on:** nothing · **Files:** new
`packages/core-rs/crates/mainframe-server/tests/ws_first_send_fanout.rs`

Write one new integration test file. Do not edit `ws_integration.rs` (it is 256 lines; four more tests would push it
past 300) and do not edit `tests/support/mod.rs` — everything needed is already public there.

### File preamble

```rust
//! Regression coverage for #275: a connection that sends `message.send` for a
//! chat and only then subscribes must still receive that chat's events emitted
//! in between. Drives the real app over the shared WS harness — the same idiom
//! as the broadcast-gating tests in `ws_integration.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::events::{
    ChatNotificationKind, ChatNotificationLevel, DaemonEvent,
};
use serde_json::json;
use support::{WsClient, spawn_test_server};

const CHAT: &str = "chat-c";
const OTHER: &str = "chat-d";
```

### Helpers

- `fn user_message_added(chat_id: &str) -> DaemonEvent` — `DaemonEvent::MessageAdded { chat_id: chat_id.into(),
  message: ChatMessage { id: "m1".into(), chat_id: chat_id.into(), r#type: ChatMessageType::User, content: vec![],
  timestamp: "2026-08-09T00:00:00.000Z".into(), metadata: None } }`.
- `fn display_messages_set(chat_id: &str) -> DaemonEvent` — `DaemonEvent::DisplayMessagesSet { chat_id: chat_id.into(),
  messages: vec![] }`.
- `async fn send_message_frame(ws: &mut WsClient, chat_id: &str)` — `send_json` of
  `{"type": "message.send", "chatId": chat_id, "content": "hello"}`.
- `async fn barrier(ws: &mut WsClient, tag: &str)` — the D3 sentinel. Sends `{"type": "subscribe", "chatId": tag}`,
  then loops `ws.wait_for("subscribe:ack")` until the frame's `chatId` equals `tag`, discarding earlier acks. Carry
  this comment verbatim above it:

  ```rust
  // `message.send` answers nothing when it succeeds, so a test cannot otherwise
  // know the daemon has handled it. The connection task handles frames serially,
  // so an ack for a LATER frame proves the earlier handler already ran — that is
  // what makes publishing on `ctx.broadcast` below race-free. Do not remove.
  ```
- `async fn drain_subscribe_frames(ws: &mut WsClient, chat_id: &str)` — reads three frames with `read_event()` and
  asserts, in order, `message.queued.snapshot`, `worktree.offer.snapshot`, `subscribe:ack`, each with
  `chatId == chat_id`. This is the frame order `ws_integration.rs:38-66` already pins.

Use `read_event()` (2 s bound) rather than `wait_for` wherever the barrier has made the frame order fully determined —
it keeps the red tests failing in seconds instead of at the 10 s `wait_for` ceiling.

### Test 1 — `send_then_subscribe_delivers_the_window_events` (RED today)

Criterion: the send-before-subscribe window is delivered.

1. `spawn_test_server(None)`; `WsClient::connect(server.addr, "/", None)`; `wait_for("connection.ready")`.
2. `send_message_frame(&mut ws, CHAT)`.
3. `barrier(&mut ws, "barrier-1")`.
4. `let _ = server.ctx.broadcast.send(user_message_added(CHAT));` then the same for `display_messages_set(CHAT)`.
5. `read_event()` → assert `type == "message.added"` and `chatId == CHAT`. **This is the assertion that fails against
   current code** (it times out — nothing is delivered).
6. `read_event()` → assert `type == "display.messages.set"` and `chatId == CHAT`.
7. Then send `{"type": "subscribe", "chatId": CHAT}` and `drain_subscribe_frames(&mut ws, CHAT)` — the later explicit
   subscribe must remain a no-op insert that still emits both snapshots and the ack.

### Test 2 — `subscribe_then_send_delivers_each_event_exactly_once` (GREEN guard)

Criterion: no duplicates from the implicit registration.

1. Connect; `wait_for("connection.ready")`.
2. Send `subscribe` for `CHAT`; `drain_subscribe_frames(&mut ws, CHAT)`.
3. `send_message_frame(&mut ws, CHAT)`; `barrier(&mut ws, "barrier-2")`.
4. Broadcast `user_message_added(CHAT)`, then `display_messages_set(CHAT)` — the criterion covers *each* of the two
   events, not just the first.
5. `read_event()` → assert `message.added` with `chatId == CHAT`; `read_event()` → assert `display.messages.set` with
   `chatId == CHAT`. A duplicated `message.added` fails the second assert, because FIFO delivery off one ordered pump
   would put the duplicate here.
6. `ws.assert_absent("display.messages.set", Duration::from_millis(400))` — **this type, not `message.added`.** A
   duplicate `display.messages.set` is the only duplicate step 5 cannot catch, and an `assert_absent("message.added")`
   would consume it while passing.

### Test 3 — `unsubscribe_releases_membership_gained_by_sending` (RED first half, guard second)

Criterion: implicit membership is releasable. Note the shape: asserting only the absence after `unsubscribe` would pass
vacuously today, so the test must first prove membership existed.

1. Connect; `wait_for("connection.ready")`.
2. `send_message_frame(&mut ws, CHAT)`; `barrier(&mut ws, "barrier-3a")`.
3. Broadcast `user_message_added(CHAT)`; `read_event()` → assert `message.added` with `chatId == CHAT`. **Red against
   current code.**
4. Send `{"type": "unsubscribe", "chatId": CHAT}`; `barrier(&mut ws, "barrier-3b")`.
5. Broadcast `user_message_added(CHAT)` again; `ws.assert_absent("message.added", Duration::from_millis(400))`.

### Test 4 — `sending_to_one_chat_leaks_nothing_from_another` (GREEN guard)

Criterion: scoping is unchanged — no leak to an unrelated chat, and global / `chatId`-less events still reach everyone.

1. Connect; `wait_for("connection.ready")`.
2. `send_message_frame(&mut ws, CHAT)`; `barrier(&mut ws, "barrier-4")`.
3. Broadcast in this order, so that the single ordered pump makes a leak observable as an out-of-order first frame:
   a. `user_message_added(OTHER)` — must be withheld;
   b. `DaemonEvent::ProcessStopped { process_id: "p1".into() }` — carries no `chatId`, must be delivered;
   c. `DaemonEvent::ChatNotification { chat_id: OTHER.into(), title: "Task Complete".into(), body: "done".into(),
      level: ChatNotificationLevel::Success, kind: Some(ChatNotificationKind::TaskComplete) }` — connection-global,
      must be delivered even though its chat was never subscribed.
4. `read_event()` → assert the **first** frame is `process.stopped` (not `message.added`); `read_event()` → assert
   `chat.notification` with `chatId == OTHER`.
5. `ws.assert_absent("message.added", Duration::from_millis(300))`.

### Verify

From `packages/core-rs`:

- `cargo test -p mainframe-server --test ws_first_send_fanout` — tests 2 and 4 pass; tests 1 and 3 **fail**. Record the
  failure output in the commit message; a green run here means the test does not exercise the defect and the task is
  not done.
- `cargo fmt --check` and `cargo clippy -p mainframe-server --all-targets -- -D warnings` pass.
- `wc -l crates/mainframe-server/tests/ws_first_send_fanout.rs` is under 300.

### Commit

`test(server): pin the send-before-subscribe fan-out window (#275)` — stage only the new test file. The failing tests
are the point of the commit; say so in the body.

---

## Task 2 — Register the sender as a subscriber of its target chat

**Group:** `ws-fanout-fix` (kind `core`) · **Depends on:** `ws-fanout-tests` · **Files:**
`packages/core-rs/crates/mainframe-server/src/websocket.rs`

Three edits, no others.

1. **Call site (`:486-493`)** — pass the subscription set through:

   ```rust
   ClientEvent::MessageSend { chat_id, content, attachment_ids, metadata } => {
       handle_message_send(ctx, out_tx, subscriptions, chat_id, content, attachment_ids, metadata).await;
   }
   ```

2. **`handle_message_send` (`:504-528`)** — add `subscriptions: &Arc<Mutex<HashSet<String>>>` as the third parameter,
   and make the first statement of the body:

   ```rust
   // The sender is the one connection guaranteed to care about this chat, and
   // send_message emits the user message before this task ever reads the client's
   // `subscribe` frame — without membership here the fan-out drops those events.
   lock(subscriptions).insert(chat_id.clone());
   ```

   It must sit **above** the `let Some(cm) = ctx.chat_manager.as_ref() else { … }` seam check, so registration does not
   depend on the chat manager being wired or on the send succeeding. Extend the doc comment above the function with one
   sentence stating that the sending connection is registered as a subscriber of `chat_id` first.

   **Write it as a bare statement, never `let guard = lock(subscriptions);`.** A `MutexGuard` bound to a local is held
   across the `.await` below it, which makes the future non-`Send` and fails compilation at `upgrade.on_upgrade(...)`
   with an error that points at the spawn, not at this line. The statement form drops the guard at the semicolon.

3. **PORT STATUS footer** — append one sentence to the existing `notes:` block: `message.send` also registers the
   sending connection as a subscriber of its target chat before the seam check, so events emitted in the
   send-before-subscribe window are no longer dropped (#275).

Do not change `fanout`, `CONNECTION_GLOBAL_EVENT_TYPES`, the `Subscribe`/`Unsubscribe` arms, or
`handle_permission_respond`.

### Verify

From `packages/core-rs`:

- `cargo test -p mainframe-server --test ws_first_send_fanout` — all four tests pass, including the two that failed in
  Task 1.
- `cargo test -p mainframe-server --test ws_integration` — the existing WS suite is unaffected.
- `cargo clippy -p mainframe-server --all-targets -- -D warnings` and `cargo fmt --check` pass (in particular, no
  `too_many_arguments`).
- The function stays under 50 lines: `awk 'NR>=504 && NR<=535' crates/mainframe-server/src/websocket.rs` — or simply
  read it; it lands at ~28 lines.

### Commit

`fix(server): deliver a chat's events to the connection that sent the message (#275)` — stage only `websocket.rs`.

---

## Task 3 — Changeset and full-suite verification

**Group:** `ws-fanout-fix` (kind `core`) · **Depends on:** `ws-fanout-tests` · **Files:** new `.changeset/*.md`

1. `pnpm changeset` → select `@qlan-ro/mainframe-app-tauri`, bump `patch` (D7, finding 10). Write the summary in plain
   user-facing prose, roughly: *"The daemon no longer discards a chat's events for the client that sent the message. A
   client that sends a message and only then subscribes to the chat used to lose its own message's events for that
   connection — there was no replay. The sending connection is now a subscriber of the chat it sends to, released as
   usual on unsubscribe or disconnect."* No emoji, no file or function names.
2. Run the full crate gate from `packages/core-rs`, matching CI (finding 9):
   - `cargo fmt --check`
   - `cargo clippy --all-targets -- -D warnings`
   - `cargo test`
   - `tools/verify-gate.sh`

### Verify

All four commands exit 0. `git status --short` shows nothing beyond the changeset (this task adds no source change).

### Commit

`chore: changeset for the WS first-send fan-out fix (#275)` — stage only the new `.changeset/*.md`.

---

## Out of scope (from the brief, restated so no task drifts into it)

- Restructuring the WS connection task so chat-mutating frames stop blocking the read loop. This fix does not need it.
- Weakening PR #539's client-side safety nets (`chatControllerRegistry.adopt()`, the once-per-controller history seed,
  the `subscribe:ack` re-seed). They stay.
- The mobile client and its submodule pointer.
- Splitting `websocket.rs` to satisfy the 300-line limit (D4) — file it as its own todo.
- Implicit membership for `permission.respond` (D5).

## Risks

- **The two red tests are the whole safety net.** If Task 1 lands green, the defect is not being exercised and Task 2
  proves nothing. The Task 1 gate is "these two must fail".
- **Barrier removal reintroduces flake.** A reviewer who reads the sentinel subscribe as noise and deletes it turns
  every test into a race with the frame handler. The comment in D3 is mandatory.
- **Membership growth per connection** (D6) is accepted, not fixed.
