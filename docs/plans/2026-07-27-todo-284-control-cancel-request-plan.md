# Todo #284 — Honor the Claude CLI's `control_cancel_request`

**Route:** no-spec (implementation plan works directly from the approved Agent Brief)
**Branch:** `todo/284-control-cancel-request` · **Worktree:** `.worktrees/todo-284-control-cancel-request`

## Goal

The Claude CLI withdraws a permission request it has already sent by emitting
`{"type":"control_cancel_request","request_id":"…"}` — it does this when a
PermissionRequest hook decides the call first, when the turn is interrupted, or
when the tool use is abandoned. The Rust daemon's control-event dispatcher has no
arm for that frame, so it falls through `_ => {}` and the prompt stays in the
chat's pending queue forever: it keeps rendering, it is re-delivered on every
subscribe, and the only way out is to answer a security question about an
operation that will not happen. This change adds the dispatch arm, gives the
per-chat pending queue removal-by-id (keeping the `VecDeque` and its ordering),
routes the removal to the client over the existing `permission.resolved` event,
promotes the next queued prompt when the cancelled one was at the front, refuses
to forward a permission answer for a request the CLI already withdrew, and makes
the previously silent dispatcher fall-through log the unhandled type at debug.

## Constraints

- `CLAUDE.md`: max 300 lines/file, 50 lines/function; no silent catches; tests
  required for new core logic; single canonical type in `mainframe-types`;
  changeset required before commit.
- Rust CI gates (`.github/workflows/rust-port.yml`, run from `packages/core-rs`):
  `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- The WS/REST contract is co-owned by the mobile submodule — changes must be
  **additive**. This plan adds no new client-bound message shape (see D1), so no
  Zod/schema surface changes.
- `crates/mainframe-chat/src/event_handler.rs` is already 1956 lines. Do not grow
  its test module; new tests go in `src/event_handler/<name>_tests.rs`, following
  the existing `worktree_trigger_tests.rs` precedent.

## Verified facts this plan is built on

| Fact | Evidence |
|---|---|
| Cancel frame shape is `{ type, request_id }`, top-level id, no bulk form | `docs/adapters/claude/PROTOCOL_REVERSED.md:650-656`, `docs/adapters/claude/PERMISSIONS.md:244-250` |
| Dispatcher drops it | `crates/mainframe-adapter-claude/src/events.rs:390-423` (`_ => {}`) |
| Pending store is a per-chat `VecDeque`, front = active, removal only from the front | `crates/mainframe-chat/src/permission_manager.rs:18,62-70` |
| The daemon only ever emits `permission.requested` for the **front** entry | `crates/mainframe-chat/src/event_handler.rs:579-608` (`if is_first`) and `permission_handler.rs:281-304` (promote after `shift`) |
| The client removes a prompt by `requestId` from a keyed record — non-front removal already works | `packages/ui/src/features/chat/controller/chat-thread-state.ts:364-371` |
| `restore_pending_permission` synthesizes entries with an **empty** `request_id` | `crates/mainframe-chat/src/permission_manager.rs:124-134` |
| App reload re-reads the live in-memory queue via `GET /api/chats/:id/pending-permission`; the transcript-restore path runs only on a **cold** message cache | `crates/mainframe-server/src/routes/chats.rs:162`, `chat_manager.rs:1509-1540` |

## Decisions

**D1 — Reuse `permission.resolved` unchanged; do NOT add a `reason` discriminator.**
The brief recommended reusing the event "with a reason/outcome discriminator." No
consumer needs it: the UI's removal path is identical for both outcomes, the
brief rules out any visible trace of a withdrawal, and the daemon log already
carries the evidence. Shipping an unread wire field would violate the repo's
dead-code rule, and adding the field later stays additive (removing it later
would not). Recorded as a deviation.

**D2 — No bulk-cancel path.** The protocol docs record exactly one cancel form,
carrying a single `request_id`; interrupts reach the daemon through the separate
`interrupt` control request. Per the brief, we handle only what the CLI sends.

**D3 — Keep the `VecDeque`; remove by positional scan.** Queues hold a handful of
entries and their order is load-bearing.

**D4 — Remember cancelled request ids per chat (bounded, 32) and drop any
permission answer that names one.** The brief's acceptance criterion "no
permission response is sent to the CLI for a cancelled request" is not met by UI
removal alone: a click already in flight when the cancel lands would otherwise be
forwarded — and when the cancel emptied the queue, `respond_to_permission`'s
stale-response guard does not even fire (it is gated on `has_pending`), so the
answer would take the no-session branch, `clear()` the chat's permission state and
respawn the CLI. A small per-chat ring of cancelled ids closes that race. It is
cleared with the rest of the chat's permission state.

**D5 — Daemon-restart resurrection stays out of scope.** The pending queue has
never been persisted; after a daemon restart a *cold* message-cache load can
re-synthesize a prompt from an unanswered `tool_use` — pre-existing behavior,
identical for cancelled and never-answered calls, and orthogonal to this fix. The
brief's criterion covers client resubscribe/reload, which reads the live queue.

## Task groups

Three groups. Group 1 is all Rust (`packages/core-rs`), group 2 is UI tests
(`packages/ui`), group 3 is docs + changeset. No file is touched by two groups, so
all three can run in parallel.

---

## Group 1 — Daemon: cancel handling (Rust)

TDD note for every pair below: write the test file first. Rust will not compile a
test against an API that does not exist yet, so add the new signatures with
`todo!()` bodies in the same step, run the test to see it fail, then fill the
bodies in the implementation task.

### T1 (test) — `PermissionManager` cancel unit tests

**Files:** create `packages/core-rs/crates/mainframe-chat/src/permission_manager/cancel_tests.rs`;
add `#[cfg(test)] mod cancel_tests;` at the bottom of
`packages/core-rs/crates/mainframe-chat/src/permission_manager.rs` (above the
`// PORT STATUS` block), mirroring `event_handler.rs:1182-1183`.

Tests (assert on resulting queue contents and returned outcome, never on call
order). Build `ControlRequest` values with a local helper.

1. `cancelling_the_front_request_returns_the_next_as_the_new_front` — enqueue
   `r1`,`r2`,`r3`; cancel `r1` → `CancelOutcome::Front { next: Some(r2) }`;
   `get_pending()` is `r2`.
2. `cancelling_a_middle_request_leaves_the_front_and_the_order_intact` — cancel
   `r2` → `CancelOutcome::Queued`; front stays `r1`; `shift` then yields `r3`.
3. `cancelling_the_only_request_empties_the_chat` — cancel `r1` →
   `Front { next: None }`; `has_pending` false.
4. `cancelling_an_unknown_id_is_a_noop` — cancel `"nope"` →
   `CancelOutcome::Unknown`; queue unchanged (front + length).
5. `an_empty_request_id_never_matches_a_restored_placeholder` — seed via
   `restore_pending_permission` (which inserts `request_id: ""`), cancel `""` →
   `Unknown`; the placeholder survives.
6. `a_cancel_only_touches_the_named_chat` — same `request_id` enqueued on chat
   `a` and chat `b`; cancel on `a` → `b`'s queue is untouched.
7. `a_cancelled_id_is_remembered_and_cleared_with_the_chat` — after a successful
   cancel `was_cancelled(chat, id)` is true, `was_cancelled(other_chat, id)` is
   false, and `clear(chat)` makes it false again.
8. `cancelled_ids_are_bounded` — cancel 40 distinct ids on one chat; the oldest is
   forgotten, the newest is remembered (cap 32).

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat cancel_tests`
(red before T2, green after).

### T2 (impl) — removal by id + cancelled-id memory in `PermissionManager`

**File:** `packages/core-rs/crates/mainframe-chat/src/permission_manager.rs`

- Add `const CANCELLED_MEMORY: usize = 32;`.
- Add a public outcome enum next to the struct:
  ```rust
  #[derive(Debug, Clone, PartialEq)]
  pub enum CancelOutcome {
      /// The active (front) request was removed; `next` is the promoted request.
      Front { next: Option<ControlRequest> },
      /// A request behind the front was removed; the front is unchanged.
      Queued,
      /// No request with that id is pending on this chat.
      Unknown,
  }
  ```
- Add field `cancelled_requests: HashMap<String, VecDeque<String>>`.
- Add `pub fn cancel(&mut self, chat_id: &str, request_id: &str) -> CancelOutcome`:
  return `Unknown` immediately when `request_id.is_empty()` (a restored
  placeholder carries an empty id and must never be matched); look up the chat's
  queue; `position(|r| r.request_id == request_id)`; `None` → `Unknown`; else
  `remove(idx)`, record the id in `cancelled_requests` (push_back, `pop_front`
  past `CANCELLED_MEMORY`), drop the chat entry when the queue empties, and
  return `Front { next: … }` for `idx == 0`, `Queued` otherwise. Keep the function
  under 50 lines — factor the ring-buffer push into a small private helper.
- Add `pub fn was_cancelled(&self, chat_id: &str, request_id: &str) -> bool`
  (false for an empty id).
- Extend `clear` to also `self.cancelled_requests.remove(chat_id)`.
- Update the `// PORT STATUS` note: this is Rust-side behavior with no TS
  original — say so in one line.

**Verify:** `cargo test -p mainframe-chat cancel_tests` green; `cargo clippy -p mainframe-chat --all-targets -- -D warnings`.

### T3 (test) — adapter dispatch tests for the cancel frame

**File:** `packages/core-rs/crates/mainframe-adapter-claude/src/events.rs`
(existing `mod tests`): add `cancelled: Vec<String>` to `Rec` and
`fn on_permission_cancelled(&self, request_id: &str)` to `RecordingSink`.

1. `control_cancel_request_forwards_the_request_id_to_the_sink` — feed
   `{"type":"control_cancel_request","request_id":"req_7"}` →
   `sink.r().cancelled == ["req_7"]`, and `permissions` stays empty.
2. `a_cancel_frame_without_a_request_id_forwards_nothing` — feed
   `{"type":"control_cancel_request"}` → `cancelled` empty (no empty-string
   forward).
3. `an_unknown_event_type_touches_no_sink_callback` — feed
   `{"type":"stream_event"}` → every recorder counter stays at zero (pins the
   `_ => {}` arm as *drop*, now that it also logs).

**Verify:** `cargo test -p mainframe-adapter-claude cancel`.

### T4 (impl) — `SessionSink::on_permission_cancelled` + the dispatch arm

**Files:**
- `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs` — add to
  `SessionSink`, after `on_permission`:
  ```rust
  /// The CLI withdrew a control request it already sent
  /// (`control_cancel_request`). Implementations remove the named pending
  /// permission and must never treat it as an answer. Default no-op: adapters
  /// whose CLI has no cancel frame need not implement it.
  fn on_permission_cancelled(&self, _request_id: &str) {}
  ```
- `packages/core-rs/crates/mainframe-adapter-claude/src/events.rs`:
  - add `fn handle_control_cancel_request_event(event: &Value, sink: &dyn SessionSink)`
    — read the top-level `request_id` as `&str`; when it is absent or empty,
    `tracing::warn!` that the cancel frame is unusable and return (no silent
    drop); otherwise `sink.on_permission_cancelled(request_id)`.
  - add `Some("control_cancel_request") => handle_control_cancel_request_event(event, sink),`
    to `handle_event`.
  - replace the trailing `_ => {}` with a `tracing::debug!(session_id = %session.id, r#type = ?ty, "claude: unhandled event type")` arm.
  - update the `// PORT STATUS` notes block at the end of the file: the cancel arm
    is Rust-only (no TS original) and the fall-through now logs.

**Verify:** `cargo test -p mainframe-adapter-claude cancel` green; `cargo check`.

### T5 (impl) — keep the delegating sinks honest

**Files:**
- `packages/core-rs/crates/mainframe-adapter-codex/src/event_mapper.rs` — add
  `fn on_permission_cancelled(&self, request_id: &str) { self.inner.on_permission_cancelled(request_id); }`
  to `impl SessionSink for ParentIdSink`. `ParentIdSink` forwards every callback;
  a wrapper that silently swallows a new one is a trap for whoever adds a cancel
  frame to another adapter. This is forwarding only — no Codex control flow.
- `packages/core-rs/crates/mainframe-adapter-mock/src/dispatch.rs` — add
  `"onPermissionCancelled" => sink.on_permission_cancelled(&arg::<String>(event, 0)?),`
  so a recorded fixture can replay a cancel instead of hitting the
  "unknown recorded sink method" warn.

**Verify:** `cargo check` from `packages/core-rs`.

### T6 (test) — sink-level cancel behavior and emitted events

**Files:** create
`packages/core-rs/crates/mainframe-chat/src/event_handler/permission_cancel_tests.rs`;
add `#[cfg(test)] mod permission_cancel_tests;` next to the existing
`mod worktree_trigger_tests;` declaration in `event_handler.rs:1182-1183`.

Copy the `worktree_trigger_tests.rs` shape: a local `EventHandlerDeps` fake that
records `emit_event` payloads and returns an `ActiveChat` from
`crate::test_support::test_chat`, with `should_notify_permission` returning
`true` so the promotion push is observable. Hold the `Arc<Mutex<PermissionManager>>`
in the test so queue state can be asserted directly; build the sink through
`EventHandler::new(...).build_sink("chat-1", None)`.

1. `cancelling_the_active_request_resolves_it_and_promotes_the_next` — drive
   `on_permission(r1)`, `on_permission(r2)`, then
   `on_permission_cancelled("r1")`. Assert the emitted events after the cancel
   are exactly `PermissionResolved { request_id: "r1" }`, then
   `PermissionRequested { request: r2, notify: true }`, then `ChatUpdated`; the
   manager's front is `r2`.
2. `cancelling_the_last_request_resolves_it_and_promotes_nothing` — one request;
   cancel it → `PermissionResolved` + `ChatUpdated`, no `PermissionRequested`;
   `has_pending` false.
3. `cancelling_a_queued_request_emits_nothing_and_keeps_the_front` — cancel `r2`
   of `[r1, r2]` → no events emitted (the client was never told about `r2`);
   front is still `r1`; `shift` no longer yields `r2`.
4. `cancelling_an_unknown_request_emits_nothing_and_leaves_the_queue` — cancel
   `"ghost"` → no events; queue unchanged.
5. `a_cancelled_request_is_remembered_for_the_answer_guard` — after cancelling
   `r1`, `was_cancelled("chat-1", "r1")` is true.

**Verify:** `cargo test -p mainframe-chat permission_cancel_tests`.

### T7 (impl) — `SessionSinkImpl::on_permission_cancelled`

**File:** `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`, in
`impl SessionSink for SessionSinkImpl`, directly after `on_permission`
(`:579-608`).

```
fn on_permission_cancelled(&self, request_id: &str)
```
- Call `self.permissions.lock()…cancel(&self.chat_id, request_id)` and release
  the lock before emitting (the crate's rule 4: no I/O under a lock).
- `CancelOutcome::Unknown` → `debug!(chat_id, request_id, "permission cancel for an unknown or already-resolved request")` and return. This is an ordinary race, not an error.
- `CancelOutcome::Queued` → `debug!` that a not-yet-presented request was
  withdrawn, and return: the client was never told about it, so there is nothing
  to remove client-side.
- `CancelOutcome::Front { next }` → emit `DaemonEvent::PermissionResolved { chat_id, request_id }`; when `next` is `Some`, emit
  `DaemonEvent::PermissionRequested { chat_id, request, notify }` and, when
  `notify`, the same `PushOut` the answer path sends
  (`permission_handler.rs:286-303`); then emit `DaemonEvent::ChatUpdated` from
  the active chat, matching both the answer path and `on_permission`.
- Keep the function ≤50 lines; factor the "promote next" block into a private
  helper on `SessionSinkImpl` if it does not fit, and reuse that helper from
  nothing else (the answer path lives in another type).

**Verify:** `cargo test -p mainframe-chat permission_cancel_tests` green;
`cargo clippy --all-targets -- -D warnings`.

### T8 (test) — an answer for a cancelled request is never forwarded

**Files:** create
`packages/core-rs/crates/mainframe-chat/src/permission_handler/cancelled_guard_tests.rs`;
add `#[cfg(test)] mod cancelled_guard_tests;` at the bottom of
`permission_handler.rs` (above `// PORT STATUS`).

Write a minimal `PermissionHandlerDeps` fake: `get_active_chat` → `None`,
`start_chat` → increments a counter, everything else trivial (empty vecs, `false`,
no-op). No fake `AdapterSession` is needed — with no active chat, an unguarded
response takes the `handle_no_session_permission` branch, which is observable
through `start_chat` and through `PermissionManager::clear`.

1. `an_answer_naming_a_cancelled_request_is_dropped` — seed the manager with
   `r1`,`r2`, cancel `r1`, then `respond_to_permission(chat, allow(r1))` →
   `Ok(())`, `start_chat` never called, and `r2` is still pending.
2. `an_answer_for_a_live_request_still_reaches_the_no_session_path` — same setup
   without a cancel → `start_chat` called once (proves the guard is not
   swallowing normal answers).

**Verify:** `cargo test -p mainframe-chat cancelled_guard_tests`.

### T9 (impl) — the answer guard

**File:** `packages/core-rs/crates/mainframe-chat/src/permission_handler.rs`, as
the **first** statement of `respond_to_permission` (before `get_active_chat`, so
it also covers the no-session branch):

```rust
if self.permissions.lock().unwrap_or_else(|e| e.into_inner())
    .was_cancelled(chat_id, &response.request_id)
{
    info!(chat_id, request_id = response.request_id,
        "respondToPermission: request was cancelled by the CLI, dropping the answer");
    return Ok(());
}
```
Update the `// PORT STATUS` notes to record the guard as a Rust-side addition
(no TS original).

**Verify:** from `packages/core-rs`: `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings`, `cargo test` (full crate suite for
`mainframe-chat`, `mainframe-adapter-claude`, `mainframe-adapter-codex`,
`mainframe-adapter-mock`).

---

## Group 2 — Client: pending-permission removal (UI tests)

No production change is required: `chat-thread-state.ts:364-371` removes by
`requestId` from a keyed record, so a non-front removal already preserves the
other entries, and `handle-daemon-event.ts:71-76` already maps
`permission.resolved` for the matching chat. These tests pin that behavior so the
daemon's new emitter has a guarded contract on the client side.

### T10 (test) — reducer removes a non-front permission

**File:** create
`packages/ui/src/features/chat/controller/__tests__/chat-thread-state-permissions.test.ts`
(follow the shape of the sibling `chat-thread-state-queued.test.ts`).

1. `removes only the named permission and leaves the others in place` — reduce
   three `permission.requested` events (`r1`,`r2`,`r3`), then
   `permission.resolved` for `r2`; assert `Object.keys(interactions.permissions)`
   is `['r1','r3']` and both surviving entries are the same objects (askedAt
   preserved).
2. `resolving the front leaves the rest presentable` — resolve `r1`; assert
   `selectPermissionFront` (from `../../gates/select-front`, the askedAt-sorted
   queue-front gate the prompt UI uses) now returns the `r2` entry.
3. `resolving an unknown requestId leaves the map untouched`.

### T11 (test) — daemon-event routing for a cancelled prompt

**File:** `packages/ui/src/features/chat/controller/__tests__/handle-daemon-event.test.ts`
(append a `describe` block).

1. `permission.resolved maps to a removal for the matching chat`.
2. `permission.resolved for another chat is a noop` — pins the per-chat scoping
   the brief requires on the client too.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-state-permissions.test.ts`
and the same for `handle-daemon-event.test.ts` (single files — batch runs hit the
cross-file `React.act` failure); then
`pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

## Group 3 — Docs + changeset

### T12 — retire the "flagged, not fixed" adapter-mismatch note

**Files:**
- `docs/adapters/claude/PERMISSIONS.md` — delete the
  `> **Adapter mismatch (flagged, not fixed).** …` blockquote at `:249-256` and
  rewrite the sentence above it to state that Mainframe removes the named pending
  request and never answers it. In the "What Mainframe's Adapter Should Rely On"
  list, drop `control_cancel_request` from the still-unhandled item 7, leaving
  `SandboxNetworkAccess`, mid-run bypass demotion, and the denial budget.
- `docs/adapters/claude/CONSUMED-SURFACE.md` — add a row after `CLAUDE-CTRL-02`:
  `CLAUDE-CTRL-05 | Inbound control_cancel_request | Top-level request_id; removes exactly that pending permission, promotes the next queued prompt, never answers the CLI | src/events.rs::handle_control_cancel_request_event, mainframe-chat/src/permission_manager.rs::cancel, mainframe-chat/src/event_handler.rs::on_permission_cancelled | src/events.rs::control_cancel_request_forwards_the_request_id_to_the_sink, mainframe-chat/src/permission_manager/cancel_tests.rs | — | A withdrawn prompt sticks in the UI forever (regression of #284)`.
- Leave `PROTOCOL_REVERSED.md`, `.claude/skills/claude-protocol-debugger/cli-binary-internals.md`,
  and `docs/research/2026-07-25-todo-241-…md` untouched: the first two describe CLI
  behavior, the third is a dated finding record.

### T13 — changeset

**File:** create `.changeset/claude-cancel-permission-request.md` with
`'@qlan-ro/mainframe-ui': patch` frontmatter (the UI package is the versioned
surface touched; the Rust daemon ships inside it) and a body that states the
user-visible fix: a permission prompt the agent withdraws now disappears on its
own instead of waiting for an answer it can no longer use, and the next queued
prompt takes its place.

**Verify:** `git status` shows the changeset; `pnpm changeset status` runs clean.

---

## Definition of done

- `cd packages/core-rs && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` green.
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` green; both touched vitest files
  green when run individually.
- Every acceptance criterion in the brief maps to a named test above: front
  cancel (T6.1), non-front cancel (T1.2/T6.3), unknown id (T1.4/T6.4), per-chat
  scoping (T1.6/T11.2), no answer forwarded (T8.1), client non-front removal
  (T10.1), fall-through logging (T4, pinned by T3.3).
- Changeset present; no file over 300 lines, no function over 50.
