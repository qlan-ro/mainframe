# Revision-versioned resume cursors (todo #377)

Route: no-spec, working from the approved brief. PR #735 (`fix/long-chat-streaming`) is merged, and this branch is based on `origin/main` (88d633cb), so this is not stacked. The lane owns independent review. Long form: the expected source diff is well over 150 lines across two runtimes.

## Goal

A reconnecting client sends a server-issued `{epoch, revision}` cursor. Within a retained epoch, `session/resume` sends exactly the changes after that revision: edits and meta changes to items the client already holds, new items, and clears for deleted items. An unknown epoch, an evicted log, a revision older than the retained tombstone range, or a revision ahead of the log gets an atomic full replay marked `fullReplay`. The client keeps a durable cursor and advances it only after the frames it covers have been applied. An aborted or interrupted replay leaves the cursor where it was. Item cursors keep working for peers that do not negotiate the feature.

## Design

**Wire contract.**
- `ReplayCursor` gains `{ "type": "revision", "epoch": string, "revision": u64 }`. `start` and `item` are unchanged.
- The daemon advertises `revisionCursors: true` in `MainframeCapabilities`.
- A client opts in with `initialize` request `_meta["_mainframe.dev"].revisionCursors: true`. Only opted-in connections get cursor metadata and cursor frames. An old client gets byte-identical behavior.
- For an opted-in connection, every `session/resume` reply's `_meta["_mainframe.dev"]` adds `cursor: {epoch, revision}`. This is the replay boundary. `itemCount` and `fullReplay` keep their meaning.
- New notification `_mainframe.dev/cursor` with `{sessionId, epoch, revision}`. It rides the per-session throttle FIFO after the frames of the display revision it describes. Receiving it means the client now holds every change through `revision`.

**Daemon: `RevisionLog`** (new, pure, in `mainframe-acp`). Each chat has one log:
- `epoch` is supplied by the caller, since `mainframe-acp` has no id generator.
- `revision: u64`, a `seeded` flag, and `items: HashMap<id, (rev, EncodedItem)>`. A clone is kept per item. A fingerprint would mean serializing under the chat lock on every revision.
- `tombstones: VecDeque<(rev, EncodedItem)>`, bounded (about 256), plus a `floor` that is the highest evicted tombstone revision.

Operations:
- `record(items) -> Option<u64>`: one revision bump per call, and only when something changed. Changed or new items get the new revision. A vanished message or thought becomes a tombstone. A vanished tool call cannot be expressed, because live diffs leave tool calls in place, so it returns a signal that makes the caller reset the epoch.
- `seed(items)`: sets the baseline at the current revision with no bump. It is used only while the log is unseeded.
- `boundary()`.
- `plan(cursor, snapshot_items) -> Full | Incremental(Vec<SessionUpdate>)`. The plan is Full when the epoch differs, `revision < floor`, `revision > current`, or a log tool call is missing from the snapshot. Otherwise it emits `clear_update` for every log item absent from the snapshot, whatever its rev, and for every tombstone with `rev > cursor` that is absent from the snapshot. It then emits `create_update` for each snapshot item, in snapshot order, that is unknown to the log, has `rev > cursor`, or differs from the log's copy. The snapshot-differs rule covers creates and edits in a snapshot newer than the last record. The rev-independent clear covers deletions in such a snapshot: the cache can drop an item, the snapshot reads that state, and the vanish is recorded only later at a revision above the boundary. That later live diff runs against the stream seeded with the snapshot, which never held the item, so nothing else would clear it. Over-clearing is safe because the client ignores a clear for an id it does not hold.

**Daemon: hub integration** (`mainframe-server`):
- `FacadeHub` owns a bounded registry of per-chat `Arc<Mutex<RevisionLog>>` (about 32 chats, least recently touched evicted first). An evicted log means an unknown epoch, which means full replay, so eviction is always safe.
- `handle_display_revision` now encodes when the chat has a log, even with nobody attached. It records into the log, then fans out `StreamOp::Revision { items, cursor }`. Chats without a log keep the early return, so legacy-only daemons pay nothing new.
- These events reset the epoch to a fresh unseeded log with a new nanoid: `TranscriptCleared`, `Resync`, `Compaction(Done)`, and a tool-call vanish. `ChatEnded` drops the log.
- `begin_resume` installs `AwaitingSeed` first, then reads the log boundary, creating the log for an opted-in connection. That order is the race argument. Any record whose revision is above the boundary applies after `AwaitingSeed` exists, so it is buffered and comes back as catch-up. Any change at or below the boundary was emitted before the snapshot read, so the snapshot contains it. A deletion can reach the snapshot before its record, because the cache mutation and the emission are separate critical sections. `plan` therefore clears every log item the snapshot lacks, regardless of its revision.
- `dispatch_resume` gets the boundary and log handle and plans under the log lock after the snapshot. An unseeded log is seeded from the snapshot.
- Catch-up `Revision` ops carry their cursor. `buffer_op` keeps the latest revision in place, so a buffered cursor never precedes content it covers.

**Throttle.** `ThrottledFrame::Cursor(RevisionCursor)` is a new variant. `coalesce` drops every cursor frame in a batch except the last, so per-revision cursors neither break chunk coalescing nor multiply frames. `send_throttled` serializes it only for opted-in connections. Non-opted connections never enqueue it.

**Client** (`packages/ui`):
- A new `ResumeCursorTracker` (`acp-resume-cursor.ts`) owns the durable revision cursor and the legacy `lastSettledItemId`, which moves there from the plane.
- `nextReplayFrom()` picks `revision` when the daemon advertises both `revisionCursors` and `replayComplete` and a durable cursor exists. It picks `item` for a legacy daemon with a settled item. Otherwise it picks `start`.
- The reply cursor rides the window's `ReplayStage` (`replyCursor`) and is committed in the plane's `completeReplay`, before the full-stage-only `publish` early return. That function runs synchronously inside `handleReplayComplete` for a non-aborted marker. A discarded, aborted, refused or cancelled window commits nothing.
- A `_mainframe.dev/cursor` notification advances the cursor only when the epoch matches, the revision is higher, and no replay window or resume is open. An epoch change clears the cursor.
- `needs-replay`, `transcript_cleared` and a resync clear the cursor.

## Files

- Wire contract, Rust: `mainframe-types/src/acp/extensions.rs` (`MainframeCapabilities.revision_cursors`, `CursorParams`, a `RevisionCursor {epoch, revision}` value type, and a const for the opt-in key). Add fixtures under `mainframe-types/tests/fixtures/acp/`: `cursor.notification.json`, `cursor.params.json`, `session-resume.request-revision.json`, `session-resume.response-revision.json` and `initialize.request-revision-cursors.json`, and update `extensions.capabilities.json`. Register them in `tests/acp_golden_fixtures.rs`.
- Wire contract, TS: `packages/types/src/acp/extensions.ts` (capability, `RevisionCursorSchema`, `ReplayCursorSchema` union, which moves the type out of `acp-client.ts`), `extensions-notifications.ts` (`CursorParamsSchema`) and `src/__tests__/acp-golden-fixtures.test.ts` mappings.
- `mainframe-acp`:
  - New `revision_log.rs` plus `revision_log/tests.rs`.
  - `resume.rs` with a new `resume/revision.rs`, so `resume.rs` stays under 300 lines: `ReplayCursor::Revision`, boundary input to `dispatch_resume`, cursor meta.
  - `session_state/updates.rs` (`create_update` and `clear_update` become `pub(crate)`).
  - `throttle.rs` (Cursor variant and coalesce rule).
  - `stream.rs` (`push_cursor`).
  - `capabilities.rs`: advertise `revisionCursors`, add a `cursor_notification` builder, and add `client_opts_into_revision_cursors(params)`.
  - `lib.rs` exports.
- `mainframe-server/src/acp_ws`:
  - New `hub/revisions.rs` for the registry, record and epoch-reset helpers, because `hub.rs` is already at 294 lines.
  - `hub.rs` (`begin_resume` returns the boundary), `hub/fanout.rs` (`run_op` cursor, `buffer_op`), `hub/handlers.rs` (record, epoch resets, drop on end).
  - `facade_conn.rs` (opt-in flag and `send_throttled` arm) and `facade_conn/slots.rs` (`StreamOp::Revision` gains a cursor).
  - `dispatch.rs` (`dispatch_fallback` reads the opt-in on a successful `initialize`) and `dispatch/resume.rs` (thread the boundary through to `dispatch_resume`).
  - Tests: `hub/tests/` with new `revision_cursor_tests.rs`, `dispatch/resume/tests.rs`, and the port fakes these signatures touch.
- `packages/ui`:
  - `lib/daemon/acp-client.ts`: opt-in `_meta` on `initialize`, `onCursor`, and import `ReplayCursor` from types.
  - `lib/daemon/acp-notification-router.ts`: route row, listener type and `onCursor`.
  - New `features/chat/controller/acp-resume-cursor.ts` and its test.
  - `acp-session-plane.ts`, `acp-session-attachment.ts` (both at the 300-line limit, so the duplicated cursor choice in `reactivate`/`resumeFromGap` collapses into one tracker call), `acp-session-attachment-types.ts`, `acp-session-listeners.ts`, `acp-replay-coordinator.ts` (pass the reply cursor to `beginReplay`) and `acp-replay-stage.ts`.
  - Test support: `__tests__/acp-attachment-support.ts`, `acp-test-kit.ts`, and the router test.
- Docs: `docs/API-REFERENCE.md` (§ ACP Chat Facade: the `session/resume` row, the capability, and a new `_mainframe.dev/cursor` row) and `docs/guides/acp-facade.md` (resume section).
- One `.changeset/*.md` with `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui` at minor.

## Task groups

**G1 wire-contract (core).** Add the Rust and TS types, fixtures and golden-fixture registrations listed above. In TDD order, fixtures and golden tests come first and fail until the types exist. The new `MainframeCapabilities` field breaks the struct literal in `mainframe-acp/src/capabilities.rs::mainframe_capabilities`, so G1 adds `revision_cursors: None` there to keep the workspace building. G2 flips it to `Some(true)`, which is why G1 and G2 share that file. Done when both golden suites pass and the workspace builds.

**G2 daemon (core), depends on G1.**
1. Red: `revision_log` unit tests.
   - Recording an edit, a meta-only change (late turn duration) or a new item bumps exactly once.
   - An identical record does not bump.
   - A vanished message is tombstoned. A vanished tool call signals an epoch reset.
   - Tombstone overflow raises `floor`.
   - `plan` covers several cases. A pre-cursor item mutation, a meta-only change and a deletion each appear in the incremental updates, as a full `create_update` or a `clear_update`. Unchanged items do not appear. A cursor with the wrong epoch, `< floor`, or `> current` gives Full. A snapshot item that is newer than the log is replayed. A log tool call missing from the snapshot gives Full. A log message or thought recorded at a rev at or below the cursor and absent from a newer snapshot yields its `clear_update` (the deletion-before-record race).
2. Red: `resume/tests.rs` covers several cases.
   - A revision cursor with a boundary yields the incremental updates plus `cursor` meta and no `fullReplay`.
   - An expired cursor or unknown epoch yields a full replay with `fullReplay: true` and the new cursor.
   - `start` and `item` cursors without a boundary produce today's exact output.
   - An unseeded log is seeded from the snapshot.
   - Throttle and stream tests: one cursor frame survives per batch, after the content it follows, and chunks on both sides of a dropped cursor still coalesce.
3. Green: build `revision_log.rs`, the resume revision path, and the throttle and stream cursor support.
4. Red, then green, in the hub and dispatch layers.
   - A display revision for a logged chat with nobody attached is still recorded. A reconnect with the old cursor receives the late meta change and the deletion (acceptance 1).
   - For a revision racing `begin_resume`→`reset_session`, the reply boundary is at or below every catch-up cursor, and catch-up delivers the change (acceptance 3).
   - A message the client holds at a rev at or below its cursor is absent from the resume snapshot but not yet recorded as vanished. The resume reply carries its clear, and the later vanish record sends nothing more for it (acceptance 1 and 3).
   - `TranscriptCleared`, `Resync`, `Compaction(Done)` and a tool vanish rotate the epoch, so the old cursor gets a full replay. `ChatEnded` drops the log. Registry eviction gives a full replay (acceptance 4).
   - A non-opted connection sees no `cursor` meta and no cursor frames, and its item-cursor resume matches today (compatibility).
   - Existing `awaiting_seed`, `resume_race`, gate and `replay_complete` tests still pass (acceptance 5).
5. Update `docs/API-REFERENCE.md` and `docs/guides/acp-facade.md`.

Exit: the capability fixture test in `capabilities.rs` asserts `revisionCursors`, and the `mainframe-types`, `mainframe-acp` and `mainframe-server` tests and clippy pass. New files are at most 300 lines and new functions at most 50.

**G3 client (ui), depends on G1.** It shares no files with G2 and codes against the G1 contract.
1. Red: `acp-resume-cursor.test.ts`.
   - Selection follows the new-daemon, old-daemon and no-cursor matrix.
   - A reply cursor is committed only by a completed window. Abort, discard, refusal and cancel leave the cursor unchanged (acceptance 2).
   - Cursor notifications advance the cursor by max within an epoch, are ignored while a window or resume is open, and clear it on an epoch change.
   - `needs-replay` and wipe clear it.
2. Red: attachment and plane tests through the existing kit.
   - Reactivate and gap resume send `{type:'revision'}` against a daemon advertising the capability, and `{type:'item'}` against one that does not.
   - An aborted `replay_complete` followed by a gap resume re-sends the old cursor.
   - An incremental replay's `created` frame for a known id replaces that item in place.
   - The router routes `_mainframe.dev/cursor`, and the method table test stays in step.
   - `initialize` carries the opt-in `_meta`.
3. Green: build the tracker, the stage `replyCursor`, the coordinator pass-through, listener wiring, the client opt-in and `onCursor`, and the router row. Remove `lastSettledItemId` from the plane.
4. Add the changeset.

Exit: the UI and types typecheck, lint and touched vitest suites pass. `acp-session-attachment.ts`, `acp-session-plane.ts` and `acp-client.ts` stay at or under 300 lines. A grep finds `lastSettledItemId` only inside the tracker.

## Risks

- **Lock order.** Hub handlers run under the chat `MessageCache` mutex. The hub must never call into `ChatManager` while holding a log lock. `begin_resume` takes the sessions lock and the log lock one after the other, never nested. If a future change nests them, the order is log then sessions.
- **Memory.** Each logged chat keeps one transcript clone. This is bounded by the registry cap and by logs existing only for chats an opted-in client resumed. The cap is a tunable const.
- **Tool-call replay content.** `create_update` omits empty tool `content` and never sends `raw_output`. A known tool call replayed incrementally keeps any stale content if its new content is empty. The encoder never shrinks tool content to empty today. If a test shows otherwise, emit an explicit empty patch on the incremental path only.
- **Ordering of new mid-list items.** The incremental path appends unknown ids at the end, exactly as live diffs do (`ensureOrdered`). This is not a regression.
- **Session-gone arm.** The arm sends the reply and a non-aborted `replay_complete` with no replay. A client whose window is still open would commit the reply cursor. This only happens after `ChatEnded`, which drops the log, so the epoch is dead and the next resume full-replays. A client detach cancels the window first, so nothing is committed.
- **Mobile.** Mobile is out of scope. It never opts in, so it keeps today's wire.

## Established facts

- `emit_display_for` holds the `messages` mutex guard across `chat_surface::notify`, so `DisplayRevision`s are serialized and reflect cache state at emission. Receipt: `mainframe-chat/src/event_handler.rs::emit_display_for`.
- `DisplayRevision` has a single emitter. Receipt: `mainframe-chat/src/event_handler.rs` (the only `ChatSurfaceEvent::DisplayRevision {` construction outside tests).
- The hub skips encoding when no connection is attached. Receipt: `mainframe-server/src/acp_ws/hub/handlers.rs::handle_display_revision`.
- A buffered revision replaces the earlier buffered one in place, and the drain replays ops in arrival order behind the replay. Receipt: `hub/fanout.rs::buffer_op`, `hub.rs::drain_into`, `FacadeHub::reset_session`.
- `begin_resume` keeps an existing `AwaitingSeed` buffer. The session-gone arm of `reset_session` still sends the reply and `replay_complete(false)`. Receipt: `hub.rs::FacadeHub::{begin_resume,reset_session}`.
- Raw throttle frames sit in the FIFO without forcing a flush, and `coalesce` only merges consecutive same-id chunks. Receipt: `mainframe-acp/src/throttle.rs::{Throttle::push_frame,coalesce}`.
- Resume replays by seeding a fresh `SessionState` with the cursor prefix and discarding it. Meta is `itemCount` plus optional `fullReplay`. Receipt: `mainframe-acp/src/resume.rs::{replay,resume_meta,resolve_cursor}`.
- `create_update` stamps the creation marker, omits empty tool content, and sends no `raw_output`. `clear_update` is the empty-content plus null-meta upsert. Both are `pub(super)` today. Receipt: `mainframe-acp/src/session_state/updates.rs`.
- The resume snapshot and the display emission take the `messages` lock in separate critical sections, so a cache drop can appear in a snapshot before its `DisplayRevision` is recorded. Receipt: `mainframe-chat/src/chat_manager/history.rs::get_resume_snapshot`, `mainframe-chat/src/event_handler.rs::emit_display_for`.
- The client ignores a clear for an id it does not hold. Receipt: `packages/ui/src/features/chat/view-model/acp-item-accumulator.ts::applyUpsert` (returns `IGNORED`).
- `SessionState::diff` never clears vanished tool calls. Receipt: `session_state.rs::SessionState::clear_vanished`.
- `mainframe-acp` depends only on `serde`, `serde_json` and `mainframe-types`, so epoch ids come from the server, which already uses `nanoid`. Receipt: `mainframe-acp/Cargo.toml`, `hub.rs::FacadeHub::register`.
- Rust `InitializeRequest` and TS `InitializeRequestSchema` both carry an optional `_meta`. `dispatch_fallback` marks the connection negotiated on a successful `initialize`. Receipt: `mainframe-types/src/acp/session.rs::InitializeRequest`, `packages/types/src/acp/session.ts::InitializeRequestSchema`, `acp_ws/dispatch.rs::dispatch_fallback`.
- `ResumeSessionRequest.replay_from` is an opaque `Option<Value>`. Receipt: `mainframe-types/src/acp/session.rs::ResumeSessionRequest`.
- The UI router ignores notification methods it does not route. Receipt: `packages/ui/src/lib/daemon/acp-notification-router.ts::handleNotification`.
- The strict accumulator replaces a known id in place on a `created` upsert and deletes on the clear shape. Receipt: `packages/ui/src/features/chat/view-model/acp-item-accumulator.ts::applyUpsert`.
- `handleReplayComplete` calls `host.completeReplay(stage)` synchronously, and only for a non-aborted, non-refused, non-client-aborted window. The plane's `completeReplay` returns early for cursor stages after `publish`. The `itemCount` check is full-window only. Receipt: `acp-replay-coordinator.ts::{handleReplayComplete,warnOnItemCountMismatch}`, `acp-session-plane.ts::completeReplay`.
- The legacy item cursor comes from `lastSettledItemId`, set at idle and built in `reactivate` and `resumeFromGap`. Receipt: `acp-session-plane.ts::applyStateUpdate`, `acp-session-attachment.ts::{reactivate,resumeFromGap}`.
- These files are near the 300-line limit: `hub.rs` 294, `acp-session-attachment.ts` 299, `acp-session-plane.ts` 293, `acp-client.ts` 294 and `dispatch/resume.rs` 268. Receipt: `wc -l` at 88d633cb.
