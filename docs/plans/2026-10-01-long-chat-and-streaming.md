# Plan: long-chat transcript churn and streaming fixes (one PR)

Brief: `/tmp/long-chat-streaming-brief.md` (decisions D1 to D7, user-approved 2026-10-01).
Branch `fix/long-chat-streaming`, worktree `.worktrees/long-chat-streaming`, based on
`origin/main` at `f5529e95`. Wire spec: `docs/specs/2026-08-28-todo-350-wire-protocol-payload-grammar.md`.

## Goal

A chat of any length never re-renders, re-orders, retypes or re-ids old content because of
how much of it the daemon keeps in memory. Streaming animates only the part that is
actually streaming, and the final part of a turn animates even when it arrives just before
the turn ends. Concretely:

- the daemon keeps a loaded chat's whole transcript (no per-chat cap) and never pushes a
  resync because of cache retention;
- the client never fabricates an item from a patch, and a full replay builds off-screen and
  replaces the transcript in one step;
- the daemon marks the overlay-backed item as streaming, and the client maps that to the
  part's status;
- while the facade is attached, its `state_update idle` is the only stop signal.

This is over 150 lines across the daemon, the wire contract and the renderer, so it uses
the full form.

## Findings that change or sharpen the brief

Each finding comes from the current code, not from the brief's older base. Items marked
**caller decides** are small additions or deviations this plan includes by default. Drop
them if you disagree.

1. **D5 has already shipped. Keep the shipped ids.** The brief's Bug 2 evidence came from
   the primary checkout at `301f2955`, which predates `e1bb693c` ("keep prose and tool calls
   in source order", #693, released in v2.3.1). `git merge-base --is-ancestor e1bb693c
   301f2955` is false. On this branch the encoder already segments text runs
   (`mainframe-acp/src/encoder/accum.rs` `Accum::claim`). A ToolCall, ToolGroup, TaskGroup,
   TaskProgress or thought item that lands after an open segment closes it.
   The shipped ids differ from D5's proposal:
   - segment 0 keeps the unsuffixed id (Decision 23);
   - later top-level segments are `{containerId}-{n}`;
   - subagent segments are `{agentId}-message-{n}`;
   - thought segments are `{containerId}-thought-{n}`.
   D5 proposed `{container}-message-{n}`. Renaming would re-id every segmented item in
   every chat, invalidate settled resume cursors, and need a mobile change for no gain.
   The converter already renders parts in item order (`convert-acp-item.ts`
   `assistantParts`; tested since #693). **This PR keeps the shipped scheme.** The D5 work
   left is regression coverage for the streaming path (task R2) and a spec decision
   recording the segment rule, which the spec never got (task C0).
2. **D2: `_mainframe.dev/resync` has two producers besides eviction, so it stays on the
   wire.** The producers:
   - `ChatLifecycleManager::do_load_chat` (`lifecycle_manager.rs`) raises
     `ChatSurfaceEvent::Resync` whenever it repopulates the cache. That covers the #178
     reload of an attached chat after an idle offload, and the first send of a chat that was
     opened cold.
   - `fail_resume` (`mainframe-server/src/acp_ws/dispatch/resume.rs`) sends
     `resync_notification` directly on the first failed resume delivery in a streak.
   Only the eviction producer goes: `event_handler/resync.rs` and its three call sites,
   `SessionSinkImpl::append_and_display`, `on_compact` and `permission_handler/respond.rs`.
   `ChatSurfaceEvent::Resync`, `ResyncParams` (Rust and TS) and the client handler stay.
   Their docs are rewritten.
3. **D1: the `MAX_CHATS` bound can evict a running chat.** `MessageCache::evict_if_needed`
   drops the oldest *first-inserted* key (FIFO, not LRU), and nothing protects
   registry-held chats. A long-lived running chat is exactly the oldest key. The next
   `append` then starts from `or_default()`, an empty list. The emit that follows re-encodes
   a one-message window, and `SessionState::clear_vanished` clears every message item on
   the client. **Fix: the cache pins every chat that has an `ActiveChatRegistry` cell.**
   `MAX_CHATS` then only bounds unpinned cold reads (`get_messages` for chats without a
   cell).
   - The #178 offload interacts safely. It removes the registry cell and the cache entry
     together (`idle_offload.rs` step 4), so a chat is never partially present.
   - An attached on-screen chat can be offloaded; its next load re-replays through
     `Resync` (finding 2).
4. **#178 can offload a running turn (caller decides; included).** `ChatOffload::recheck`
   checks spawned, idle time, pending gate and queued refs, but not `process_state`. A turn
   whose tool runs silent for more than 2 hours would have its CLI killed mid-turn. Add a
   `process_state == Working` skip (task R1).
5. **The worktree-missing error path appends to a possibly unloaded entry.**
   `send_entry.rs` `emit_worktree_missing_error` appends before any history load. For a
   cold or evicted chat this replaces the cached transcript with one error message, and
   the next resume snapshot is just that message. Load first (task R1).
6. **`do_load_chat` resyncs needlessly (caller decides; included).** Today it raises
   `Resync` on every first send of a chat opened through `session/resume`, because the
   cache already holds the identical cold load. That forces a full replay of a
   2,560-message chat at the start of the turn. Raise it only when the reload changed the
   cached list, which includes "no previous entry" (task R1). The #178 test
   `resend_from_an_attached_chat_after_offload_resyncs_instead_of_scrambling_order` still
   holds, because the offload deleted the entry.
7. **Throttle coalescing drops a chunk's `_meta`.** `throttle.rs` `try_merge_chunk`
   concatenates text into the earlier chunk and discards the later chunk's `meta`. A commit
   that drops `streaming` rides the first chunk's meta (`content_revision`). If that chunk
   merges into a buffered one, the flag never clears on the client. The latest non-`None`
   meta must win (task R2).
8. **A retry marker can strip an item's meta (caller decides; included).**
   `stream.rs` `attach_retry_marker` merges into `slot.clone().flatten()`. On a
   full-revision upsert whose meta did not change, `meta` is `None`, so the frame wires
   `_meta: {"_mainframe.dev": {attempt, reason}}`. The client's `patchField` replaces the
   item's whole meta with that, which loses `containerId`, and the item becomes its own
   container at the tail (the same symptom as Bug 1). Carry the marker only on upserts that
   carry a full meta value (task R3).
9. **D7 changes what the UI shows during a gate (caller decides; this plan preserves the
   current behavior).** `chat_manager/shared.rs` `enrich_chat` sets
   `is_running = working && !has_pending`. Today a pending gate makes the client dispatch
   `run.stopped`, so the thread looks idle while it waits, and `run.started` follows the
   answer. If `isRunning:false` is ignored while the facade is attached, the thread shows
  "running" through every gate. When the facade is not attached, the side-band stop is
  kept as a backstop (task U3).
   Task U3 keeps today's cue by deriving the UI's `isRunning` as false while a permission
   entry is pending. This also folds the three copies of that derivation (`chat-extras.ts`
   `isRunningFromState`, `ChatZone.tsx`, `SideChatPanel.tsx`) into one.
10. **D7's ordering is necessary but not sufficient.** aui's `@assistant-ui/tap` scheduler
    flushes store updates on a MessageChannel macrotask, which the brief's harness notes
    too. A content frame and the `state_update idle` behind it in the same throttle flush
    are two WebSocket tasks, and both can run before that flush. The new text part then
    mounts `complete` and pops (Fable test 7). The plane therefore dispatches `run.stopped`
    after a short settle delay. Any `run.started`, from any source, cancels it (task U3).
11. **D6 needs explicit part statuses, not just a running part.** `@assistant-ui/core`
    `toMessagePartStatus` honors a text or reasoning part's own `status` only while the
    message is `running`; otherwise the last part inherits the message status. Without an
    explicit `complete` on replayed parts, the "running, no tokens yet" fallback stamps the
    replayed tail as running and it retypes (the Bug 1 evidence). Parts therefore carry:
    - `running` when their item is streaming;
    - `complete` when their item came from a replay;
    - no status when they were created live, which keeps today's last-part rule for Codex
      and pre-partials Claude, whose blocks arrive whole.

## Established facts (symbols on this branch)

- **The cache.** `MAX_MESSAGES_PER_CHAT = 2000` and `MAX_CHATS = 50`. `set` trims through
  `tail()`. `append` drains the front and returns `evicted`. `order` is
  insertion-ordered, and `track_key` never moves an existing key
  (`mainframe-chat/src/message_cache.rs`).
- **Cache writers.** `set` is called from:
  - `chat_manager/history.rs` `load_history_into_cache`;
  - `lifecycle_manager.rs` `do_load_chat`;
  - `event_handler.rs` `mutate_messages`;
  - `plan_mode_actions.rs` `clear_messages`.

  `append` is called from:
  - `event_handler.rs` `append_and_display` and `on_compact`;
  - `chat_manager/send.rs` (`store_user_message`);
  - `chat_manager/send_entry.rs` `emit_worktree_missing_error`;
  - `permission_handler/respond.rs`.
- **Registry cells.** Cells are inserted by:
  - `lifecycle_manager.rs` `create_chat`;
  - `lifecycle_manager.rs` `do_load_chat`;
  - `chat_manager/fork_api.rs`.

  Cells are removed by:
  - `lifecycle_manager.rs` `archive_chat`, which deletes the cache too;
  - `end_chat`, which keeps the cache;
  - `chat_manager/discard.rs`, which deletes the cache;
  - `idle_offload.rs` `try_offload`, which deletes the cache.

  `deps_recovery.rs` `clear_messages` deletes the cache entry but keeps the cell.
- **Idle offload.** `idle_scanner.rs` `select_idle_candidates` requires a spawned session
  past the threshold. `idle_offload.rs` `ChatOffload::recheck` re-checks spawned, idle,
  no pending gate and no queued refs. An unspawned cell is never offloaded.
- **Display path.** `emit_display_for` (event_handler.rs) appends
  `PartialOverlays::message_for` as a synthetic tail `ChatMessage`, runs
  `prepare_messages_for_client`, and notifies `ChatSurfaceEvent::DisplayRevision { chat_id,
  messages }`. `overlay_message` mints `timestamp: now_iso8601()` on every call
  (`event_handler/partial_overlay.rs`).
- **The overlay is one leaf, and it ends up last.** `on_message_partial` stores a single
  text or thinking leaf, emitted by `mainframe-adapter-claude/src/partial_stream.rs`. The
  overlay is the last raw message. `group_messages` merges it into the trailing
  assistant/tool_use group or opens a new one (`message_grouping.rs`), and
  `convert_assistant_content` keeps leaf order (`display_helpers.rs`). So the overlay leaf
  is the last leaf of the last `DisplayMessage`, unless its text strips to empty.
- **Encoding.** The hub encodes in `hub/handlers.rs` `handle_display_revision` →
  `mainframe_acp::encoder::encode` → `FacadeHub::on_display_revision` → `StreamOp::Revision`
  → `SessionStream::on_revision` → `SessionState::diff` → `Throttle`.
- **Diff frames.** `SessionState::diff` has three paths:
  - an unknown id gets `create_update`: a message upsert with full `content` and `meta`,
    or a tool `tool_call_update` with `title`, `kind`, `status` and `rawInput` always set
    (`session_state/updates.rs`);
  - a known id goes through `revise_update`, which emits a chunk append, a meta-only upsert
    (`content` omitted) or a full-revision upsert;
  - a vanished message or thought gets `clear_update` (`content: []` and `_meta: null`).
- **Resume replay.** `mainframe-acp/src/resume.rs` `dispatch_resume` diffs the snapshot
  against a fresh `SessionState`, so every replayed item goes through `create_update`. It
  then pushes one `state_update` (`turn_state_update(is_running)`) and returns `items` for
  seeding. The reply's `_meta["_mainframe.dev"]` carries `itemCount` (snapshot size) and
  `fullReplay` (unknown cursor).
- **Resume order on the wire** (`mainframe-server/src/acp_ws/hub.rs`
  `FacadeHub::reset_session`, called from `dispatch/resume.rs` `deliver_resume`):
  1. reply;
  2. `replay.updates`, ending with the `state_update`;
  3. the redelivered gate, if any;
  4. `queue_state`;
  5. the buffered catch-up (`drain_into`), through `send_throttled`.

  All of it runs under `connection.locked_sessions()`, so no other session frame on that
  connection interleaves. `gate_resolved` and the heartbeat are sent directly. The "session
  gone" arm sends only the reply.
- **`queue_state` is not a usable end-of-replay boundary.** It is also pushed live
  (`handlers.rs` `handle_queue_changed`), buffered and drained after the replay as catch-up,
  and absent in the session-gone arm.
- **Client accumulator.** `view-model/acp-item-accumulator.ts` `ensureOrdered` appends any
  unseen id at the end. `applyChunk`, `applyUpsert` (except the clear shape) and
  `applyToolCallUpdate` all create. `convert-acp-item.ts` `toolPart` falls back to
  `item.title ?? item.id`, and `convertAcpItems` groups by `containerId ?? item.id`.
- **Client resume.** `controller/acp-session-attachment.ts` `resume()` calls
  `resetAccumulator()` in the continuation after `await client.resume()`. This relies on
  the reply arriving before the replay frames and on microtask ordering.
  - `reattach()` pre-resets the accumulator, which wipes the visible transcript.
  - `acp-full-replay.ts` `FullReplayRetry` drops `requestResync` while in flight, and "in
    flight" ends when the RPC resolves.
  - Every replay frame calls `AcpSessionPlane.refreshMessages`, which converts the whole
    list, so a full replay rebuilds on screen frame by frame.
- **Run state today.** `controller/handle-daemon-event.ts` maps `chat.updated isRunning:false`
  to `run.stopped`. `acp-session-plane.ts` `applyStateUpdate` maps facade
  `running`/`idle` to `run.started`/`run.stopped`. `project-messages.ts` stamps the last
  assistant message `running` only when `runState.type === 'running'`.
- **aui statuses.** In `@assistant-ui/core` 0.3.12 `utils/normalizePartStatus.ts`,
  `toMessagePartStatus` gives a tool-call part without a result the message status. For
  other parts it honors the part's own `status` only while the message is `running`, and
  otherwise gives the status to the last part only. `fromThreadMessageLike` passes text and
  reasoning parts through unchanged, including `status`.
- **useSmooth.** `useSmooth` in `@assistant-ui/react` 0.15.13 chooses an empty or full
  initial text from `state.status` at mount, and again at any discontinuity.
- **Capabilities.** The daemon advertises them through `mainframe-acp/src/capabilities.rs`
  `mainframe_capabilities`, pinned by `extensions.capabilities.json`. The client reads
  `AcpFacadeClient.mainframeCapabilities`. Remote daemons can be a version behind or ahead
  of the client (spec Decision 25), so new client behavior is gated on capabilities.
- **Fixtures.** The Rust fixtures in `mainframe-types/tests/fixtures/acp/` are read by
  both `tests/acp_golden_fixtures.rs` and `packages/types/src/__tests__/acp-golden-fixtures.test.ts`.
- **Build prerequisites.** The UI consumes `@qlan-ro/mainframe-types` from `dist`, so
  rebuild types before UI tests. The worktree has no `node_modules`, so run `pnpm install`
  first.

## Design

### Daemon: cache retention is invisible (D1, D2)

- `MessageCache` drops `MAX_MESSAGES_PER_CHAT`, `tail()` and `append`'s return value.
  `append` returns `()`.
- It gains `pinned: HashSet<String>` and these methods:
  - `pin(chat_id)`;
  - `unpin(chat_id)`;
  - `release(chat_id)`, which is `delete` plus `unpin`.
- `delete` keeps the pin, for the recovery clear on a chat that is still in the registry.
- `evict_if_needed` removes the oldest *unpinned* key while `len > MAX_CHATS`. When every
  key is pinned it stops, so the registry (bounded by idle offload, end, archive and
  discard) is the real bound.
- **Pinning.** `create_chat`, `do_load_chat` and the fork insert pin right after
  `active_chats.insert`.
- **Unpinning.** Offload, archive and discard switch from `delete` to `release`.
  `end_chat` calls `unpin`, which leaves its entry evictable.
- `get_messages` warm and cold now return the same full list, because neither path trims.
- **Resync from `do_load_chat`.** Read the previous entry before `set`, and raise
  `Resync` only when `previous != Some(&remapped)`.
- **Remove the eviction resync.** Delete `event_handler/resync.rs` and its `mod`
  declaration, and remove the `notify_if_evicted` calls.
- **`ChatSurfaceEvent::Resync` doc.** It now reads: "the chat's cache was rebuilt from the
  transcript under ids an attached session may not hold". The `ResyncParams` doc in Rust
  and TS gets the same wording.
- **`ChatOffload::recheck`.** It skips a chat whose `ActiveChat.chat.process_state` is
  `Some(Some(ProcessState::Working))`.
- **`emit_worktree_missing_error`.** It becomes `async` and awaits
  `self.get_messages(chat_id)` before it appends.

### Wire: creation marker (D3, server half)

- `session_state/updates.rs` `create_update` merges `{"created": true}` into the frame's
  `_meta["_mainframe.dev"]`. It reuses `stream.rs` `merge_namespace`, made `pub(crate)`.
- Nothing else sets the marker: not revisions, meta patches, chunks or clears. Every live
  creation and every resume replay frame goes through `create_update`, so the marker
  exactly means "this frame is the item's complete first state".
- The key is a constant in both type crates: `ITEM_CREATED_META_KEY = "created"`.

Why `_meta` and not field presence:
- A message full-revision upsert (the `content_revision` non-extension path) carries
  `content`, and carries `_meta` whenever it changed, so it cannot be told apart from a
  create.
- Reading a tool create off `title` presence relies on an unstated invariant (titles never
  change).

Why not a new `SessionUpdate` variant: the vendored ACP v2 subset already uses the upsert
or `tool_call_update` as the creation grammar. `_meta` is the sanctioned extension point,
and generic clients ignore it.

Why not an `ItemMeta` field: `ItemMeta` is encoder output that the diff engine compares,
while the marker is scoped to the frame. The retry marker set the precedent.

### Wire: end-of-replay boundary (D4, server half)

- New notification `_mainframe.dev/replay_complete`, params `{ sessionId }`, built by
  `capabilities.rs` `replay_complete_notification`.
- `FacadeHub::reset_session` sends it in both arms:
  - in the seeded arm, after `replay(connection)`, which ends with `queue_state`, and
    before the catch-up loop;
  - in the session-gone arm, right after the reply.
- `ResumeSeed` gains `completed: Arc<AtomicBool>`, set as the marker goes out.
- `fail_resume` sends `replay_complete { sessionId, aborted: true }` before its `resync`
  when `replied && !completed`. `ReplayCompleteParams.aborted` is optional and present
  only on this path. A normal close carries no `aborted`.

The invariant: **every successful `session/resume` reply a client receives is followed by
exactly one `replay_complete` for that session.** Replies and markers for one session pair
up in FIFO order, because both are written under that connection's session lock or after
the reply's delivery task. Everything between a reply and its marker is replay.
Everything after the marker is live, in order, because the catch-up drains behind it.

Why not move the reply to the end (ACP `session/load` style): the replay frames then have
no start boundary. Live frames queued before `begin_resume` would be indistinguishable from
replay frames and would land ahead of them in a staging accumulator.

### Wire: item-owned streaming status (D6, server half)

- `ItemMeta.streaming: Option<bool>`, `true` only on the overlay-backed item.
- `mainframe_types::display::StreamingLeafKind { Text, Thinking }` is an in-process
  contract, not serialized.
- `ChatSurfaceEvent::DisplayRevision` gains `streaming: Option<StreamingLeafKind>`.
- `emit_display_for` sets it from the overlay's leaf kind, but only when all of these hold:
  - the overlay text is non-empty after `trim`;
  - the prepared display's last `DisplayMessage` is `Assistant`;
  - that message's last `DisplayContent` is a leaf of the same kind.
- `mainframe_acp::encoder::encode_revision(messages, streaming)` encodes like `encode`. For
  the last non-queued container, it marks the accumulator segment still open at finish
  for that kind (`Accum`'s message or thought, in `content.rs` `encode_content`), so that
  segment's `ItemMeta` gets `streaming: Some(true)`.
- `handle_display_revision` calls `encode_revision`; resume keeps `encode`, because the
  snapshot has no overlay.
- **Commit.** The overlay is taken and the committed block lands under the same item id,
  so the next diff sees the same item without the flag. The diff engine emits either a
  first chunk carrying the new meta, or a meta-only upsert, in the same diff as the final
  text.
- **Abort** (retry, interrupt, exit). The item vanishes, and `clear_update` removes it.
- **Throttle fix.** In `try_merge_chunk`, the merged chunk takes `update.meta` when it is
  `Some`.
- **Frozen timestamp.** `PartialOverlay` gains `started_at`. `PartialOverlays::insert`
  keeps the existing `started_at` when the entry for `(chat, session)` has the same
  `message_id`, and `overlay_message` uses it.
- **Data flow.** `on_message_partial` → `PartialOverlays` → `emit_display_for`
  (`streaming`) → `DisplayRevision` → `handle_display_revision` → `encode_revision` →
  `ItemMeta.streaming` → `SessionState::diff` (create or chunk meta, then meta patch or clear on
  commit/abort) → client `parseItemMeta(...).streaming` → part and message status.

### Client: accumulator never fabricates (D3, client half)

`AcpItemAccumulator` takes `{ strictCreation: boolean }`, true when the daemon advertises
`itemCreationMarkers`, and `apply()` returns
`{ kind: 'applied' | 'ignored' | 'needs-replay'; created: boolean }`.

In strict mode:
- **Creation frame for a new id.** A frame whose `_meta[ns].created === true` creates the
  item at the end of the order.
- **Creation frame for a known id.** It replaces the item's content, meta and fields in
  place.
- **Clear shape for an unknown id.** Ignored.
- **Unknown id otherwise.** Any other frame for an unknown id leaves state untouched and
  returns `needs-replay`: a chunk, a meta-only or revision upsert, a `tool_call_update`
  without the marker, or a `tool_call_content_chunk`.

Each item records `origin: 'live' | 'replay'`. A creation sets it from the accumulator's
`replaying` flag, and a patch keeps it.

Legacy mode keeps today's behavior for older daemons. `toolPart` never uses the id as a
name: a missing title renders as `'Unknown tool'`.

The plane routes `needs-replay` to the attachment's bounded resync
(`FullReplayRetry.requestResync`) only while no resume is pending. A resume is pending
from the moment its request is sent until its window closes. While any resume is pending,
the plane only logs: frames racing a resume are expected to reference ids the replay is
about to deliver.

### Client: staged, atomic full replay (D4, client half)

A new `controller/acp-transcript-store.ts` owns the visible accumulator, an optional
staging accumulator, `firstSeenAt`, and these operations:
- `target()`: where item frames go;
- `beginReplay({ full })`;
- `completeReplay()`: publishes and returns a result;
- `abortReplay()`.

A new `controller/acp-replay-window.ts` keeps a **per-attachment FIFO of replay windows**.
Each window records:
- its kind: full, cursor, or refused (the empty-refresh guard refused it);
- its state: open, or aborted;
- the last `state_update` seen inside it;
- the `itemCount` from its reply, used only for logging;
- the subscription generation it was opened under;
- a promise that always settles.

When the daemon advertises `replayComplete`, these rules apply.

**Opening a window.**
- The attachment keeps a subscription generation, bumped on every subscribe, `detach()`,
  `dispose()` and client rebind.
- A resume records the generation when it sends its request.
- In the continuation after the reply (the boundary `resetAccumulator` uses today),
  `resume()` pushes one window onto the FIFO, but only if the attachment is still
  subscribed under that generation. Otherwise it rejects with `ReplayCancelledError` at
  once and opens nothing. That covers a detach, dispose or rebind between request and
  reply.
- An error reply opens nothing and rejects as today.
- **Full window** (`start` cursor or `fullReplay: true`, not refused): frames go into a
  fresh staging accumulator with `replaying = true`. The visible transcript is left alone.
- **Cursor window:** frames apply to the visible accumulator with `replaying = true`.
- `resume()` resolves or rejects when its window settles.

**Closing with `replay_complete`.** Each `replay_complete` for this session closes the
oldest window in the FIFO. This relies on the daemon's one-marker-per-reply guarantee
(Decision 38). The outcomes:
- **Open full window, `aborted` absent:** always publishes. Staging becomes visible, the
  settled cursor is set as below, and `transcript.updated` is dispatched once.
  - A count of `created` frames that differs from `itemCount` is only logged
    (`console.warn`). `itemCount` is `items.len()` (`resume.rs` `success_response`), but
    `SessionState::diff` creates only the first occurrence of a duplicate id, and
    `parseOrWarn` drops frames it cannot parse. Gating on the count could leave the first
    attach blank forever.
- **Open full window, `aborted: true`:** staging is discarded and the visible transcript
  stays. `resume()` rejects, so `FullReplayRetry` backs off. The `resync` the daemon sends
  next is coalesced into that retry.
- **Open cursor window:** clears `replaying`.
- **Aborted window:** its marker only removes it. Its promise has already settled.
- **Refused window:** removed.
- `replay_complete` with an empty FIFO is ignored and logged.

**Settled cursor at publish.**
- Every `state_update` that arrives while a window is the oldest open one is recorded on
  that window.
- At publish, if that last state is `idle`, the cursor becomes the last staged item's id.
  Otherwise the cursor becomes `null`.
- An `idle` during staging is computed against the staging accumulator, never the visible
  one.
- A cursor window updates the cursor as today, against the visible accumulator.

**Aborting early.** Every abort settles the window's promise at once.
- **Gap, while the socket is alive:** open windows become **aborted** but stay in the
  FIFO. An aborted full window keeps its staging target and keeps absorbing and
  discarding item frames until its own `replay_complete` arrives. The rest of that replay's
  creates therefore never reach the visible accumulator and never append at its tail.
  An aborted cursor window applies its remaining frames to the visible accumulator, as
  cursor replays do.
- **Socket death** (the client's close path, which also rejects pending requests): the
  FIFO is cleared and every window settles. No marker can arrive on a dead socket.
- **`detach()`, `dispose()` or client rebind:** the listeners go and the FIFO is cleared.
  Every promise settles: quietly for a detach, and with `ReplayCancelledError` for
  callers that need it.
- **`resync` while the oldest window is open:** that window becomes aborted (staging
  discarded, visible kept). The resync then goes through `FullReplayRetry.requestResync()`,
  with backoff when the aborted window was its own run.
- `FullReplayRetry.run` treats `ReplayCancelledError` as a quiet end, not a failure. It
  always clears `inFlight` in `finally`.

**Other rules.**
- `reattach({ wipe })` no longer pre-resets. `transcript_cleared` still dispatches
  `transcript.cleared` and resets at once, then runs `reattach({ wipe: true })`, which
  bypasses the empty guard. A resync runs `reattach({ wipe: false })`, where the guard
  applies.
- `FullReplayRetry` stays in flight until the window closes, so a resync is busy until the
  end of the replay.
- No client-side buffering is needed for live frames. The daemon drains catch-up frames
  after `replay_complete`, so they reach the published accumulator in order.
- Frames between the request and the reply apply to the visible accumulator as today, and
  publishing supersedes them.

Without the capability, `resume()` keeps today's reset-at-reply path.

### Client: part status, stop signal (D6, D7)

`convert-acp-item.ts`:
- text and reasoning parts from an item with `streaming === true` get
  `status: { type: 'running' }`;
- parts from an `origin: 'replay'` item get `status: { type: 'complete' }`, unless the
  item is streaming. **`streaming === true` wins over `origin: 'replay'`.** After a
  mid-turn full replay, the overlay's text joins the open segment that was replayed
  (`Accum::claim` extends the tail segment), so a replay-origin item can become the
  streaming one;
- other parts carry no status;
- a container holding a streaming item returns `status: { type: 'running' }` on its
  `ThreadMessageLike`.

`project-messages.ts`:
- If no server message is already `running` and `runState` is `running` or `cancelling`,
  it stamps the last assistant message `running`, but only when no user message follows
  it (the current turn).
- Idle history is never stamped.

`handle-daemon-event.ts` gets a `facadeAttached` input. `chat-event-router.ts`'s host
supplies it from the plane's `isSubscribed`, through `acp-chat-controller.ts`.
- While the facade is attached, `chat.updated isRunning:false` is `noop`.
- While the facade is not attached, it still maps to `run.stopped`. This is a backstop
  for a failed or never-completed attach, where no facade `idle` can arrive.
- `isRunning:true` still maps to `run.started`.

`AcpSessionPlane.applyStateUpdate('idle')`:
- it computes the settled cursor immediately, against the staging accumulator when a full
  window is staging;
- it schedules `run.stopped` after `RUN_STOP_SETTLE_MS = 50`.

**Any** `run.started` cancels the pending stop, whatever its source: the facade's
`running`, the optimistic dispatch in `chat-actions.ts`, or `chat.updated isRunning:true`.
`acp-chat-controller.ts`'s dispatch path calls the plane's `cancelPendingStop()` before
forwarding any `run.started`. `dispose()` cancels it too.

`isRunningFromState(state)` returns false while `state.interactions.permissions` is
non-empty (finding 9). `ChatZone.tsx` and `SideChatPanel.tsx` call it instead of
duplicating it.

## Task groups

Two implementers run in parallel after C0. **Rust group** owns `packages/core-rs` except
the C0 files. **UI group** owns `packages/ui`. Neither group edits the other's files. C0
owns `packages/types`, `mainframe-types`, `mainframe-acp/src/capabilities.rs` and
`lib.rs`, the fixtures, and the docs below. G-final runs after both groups.

Shared verification setup, run once in the worktree:

```sh
pnpm install
pnpm --filter @qlan-ro/mainframe-types build
```

Rust commands run from `packages/core-rs`.

### C0 contract (first; both groups depend on it)

**Files.**
- `packages/core-rs/crates/mainframe-types/src/acp/extensions.rs`:
  - `ItemMeta.streaming`;
  - `MainframeCapabilities.item_creation_markers` and `.replay_complete` (camelCase on the
    wire);
  - `ReplayCompleteParams { session_id, aborted: Option<bool> }` (`aborted` is skipped
    when `None`);
  - `pub const ITEM_CREATED_META_KEY: &str = "created"`;
  - the `ResyncParams` doc.
- `mainframe-types/src/display.rs`: `StreamingLeafKind`, with no serde.
- `mainframe-types/tests/fixtures/acp/`:
  - new `replay-complete.notification.json`, `replay-complete.params.json` and
    `replay-complete.params-aborted.json` (`{"sessionId": …, "aborted": true}`);
  - `extensions.capabilities.json` and `initialize.response.json` gain the two flags;
  - `extensions.item-meta.json` gains `"streaming": true`;
  - `session-update.agent-message-upsert.json` and `session-update.tool-call-create.json`
    gain `"created": true` under `_meta["_mainframe.dev"]`.
- `mainframe-types/tests/acp_golden_fixtures.rs`: route the three new fixture names.
- `mainframe-acp/src/capabilities.rs`:
  - advertise both flags as `Some(true)`;
  - `replay_complete_notification(session_id, aborted: bool)`;
  - the `resync_notification` doc.
- `mainframe-acp/src/lib.rs`: export it.
- `packages/types/src/acp/extensions-payload.ts`: `ItemMetaSchema.streaming` and
  `ITEM_CREATED_META_KEY`.
- `packages/types/src/acp/extensions.ts`: `MainframeCapabilitiesSchema` flags.
- `packages/types/src/acp/extensions-notifications.ts`: `ReplayCompleteParamsSchema` and
  the `ResyncParamsSchema` doc. Add exports in `acp/index.ts` if it re-exports explicitly.
- `packages/types/src/__tests__/acp-golden-fixtures.test.ts`: route the new names.
- Docs, written first so both groups implement against them:
  - the spec amendments below;
  - the `docs/API-REFERENCE.md` facade table: replace the `resync` row, add
    `replay_complete`, add the capabilities, add `ItemMeta.streaming`, document the
    `created` marker and the resume order;
  - `docs/guides/acp-facade.md`, in "Chunks, upserts, and the clear frame", "Turn state",
    "Display metadata" and "Stay in sync" (resync row, end-of-replay including the
    `aborted` marker and FIFO pairing, run state comes only from `state_update`).

**Tests (red first).**
- Rust golden round-trip of the three new fixtures.
- `capabilities::tests::matches_the_pinned_fixture_shape` extended to the two flags.
- A new `replay_complete_matches_the_pinned_fixture` test, covering the normal close (no
  `aborted` key) and the aborted one.
- TS golden test parses all changed and new fixtures.

**Verification.**

```sh
cargo test -p mainframe-types --test acp_golden_fixtures
cargo test -p mainframe-acp capabilities
pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/acp-golden-fixtures.test.ts
pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit && pnpm --filter @qlan-ro/mainframe-types build
```

**Spec amendments** to `docs/specs/2026-08-28-todo-350-wire-protocol-payload-grammar.md`.
Each is `reversible`.

- **Decision 34, rewritten.** "`_mainframe.dev/resync` tells a client to re-resume when
  the daemon's view diverged from what the client may hold." The producers:
  - `do_load_chat` rebuilt the chat's cache from the transcript and the result differs
    from the previous entry (#178 reload of an attached chat);
  - a resume delivery failed after its reply (`fail_resume`, at most once per failure
    streak).

  Cache retention never triggers it. There is no per-chat cap (Decision 36). The client
  handles it as a staged full replay with no wipe (Decision 38), and the same bounded
  path serves the client's own needs-replay outcome (Decision 37).
- **36. No per-chat message cap.** A chat with a registry cell is pinned whole in the
  `MessageCache`. `MAX_CHATS` bounds only unpinned cold reads, and the #178 idle offload
  releases a chat as one unit. Warm and cold `get_messages` return the same list.
  Retention is never visible on the wire.
- **37. Item creation is explicit.** `create_update` stamps
  `_meta["_mainframe.dev"].created: true` on an item's complete first frame, live or
  replayed, and nothing else carries it. A Mainframe client creates an item only from such
  a frame. For an unknown id, any other frame is a needs-replay signal and never makes a
  visible item. Advertised as `itemCreationMarkers`.
- **38. `_mainframe.dev/replay_complete` closes every resume replay.** It is sent after
  `queue_state` and before the buffered catch-up, in every arm that sent a successful
  reply: seeded, session gone, and a delivery failure after the reply. The failure arm
  carries `aborted: true`. Replies and markers for a session pair up in FIFO order.
  A client builds a full replay off-screen and publishes it once, on a marker without
  `aborted`. It discards the replay on `aborted: true`. `itemCount` is advisory: duplicate
  ids and frames the client cannot parse make it differ from the creates received, so a
  mismatch is logged, never gated on. A real `transcript_cleared` still wipes at once.
  Advertised as `replayComplete`. This sharpens Decision 35 (catch-up order).
- **39. Item-owned streaming status.** `ItemMeta.streaming: true` marks the item that the
  partial-message overlay backs (Decision 23). It drops through the same diff as the
  committing text, or the item is cleared on abort. The overlay's timestamp is fixed at its
  first partial. Clients drive per-part streaming status from it, never from position.
- **40. Text runs segment at interrupting items.** This records #693 under Decision 22.
  An item sits at its first contribution. A tool call, tool group, task group, task
  progress item or thought pushed after an open text segment closes it, and the next text
  opens `{containerId}-{n}` (`{agentId}-message-{n}` under a subagent) or
  `{containerId}-thought-{n}`. Segment 0 keeps the unsuffixed id, and live, replay and
  history agree because the encoder is pure.

### Rust group (after C0; tasks in order, one owner)

#### R1 cache retention, resync producers, offload guard (`mainframe-chat`)

**Files.**
- `src/message_cache.rs`;
- `src/lifecycle_manager.rs` (`create_chat`, `do_load_chat`, `archive_chat`, `end_chat`:
  pin, unpin, release and the resync condition only);
- `src/idle_offload.rs` (`release`, plus the `process_state` check in `recheck`);
- `src/chat_manager/{discard,fork_api,send,send_entry,lifecycle_api}.rs`;
- `src/permission_handler/respond.rs`;
- `src/event_handler.rs` (`append_and_display`, `on_compact`, the `mod resync` line);
- delete `src/event_handler/resync.rs`;
- `src/chat_surface.rs` (the `Resync` doc);
- tests in `message_cache.rs`, `chat_manager/tests/resume_snapshot.rs` and
  `chat_manager/tests/offload.rs`.

**Tests (red first).**
- `message_cache`:
  - `append_never_drops_from_the_front`: 2,500 appends keep all 2,500 ids in order;
  - `set_keeps_every_message`: `set` of 2,500, then `get` returns 2,500;
  - `eviction_skips_pinned_chats`: pin `a`, insert `a`, then 50 more chats. `a` is still
    present and the oldest unpinned key is gone;
  - `all_pinned_never_evicts`: 51 pinned chats, all present;
  - `release_unpins`.
  - Delete `append_past_the_cap_reports_an_eviction`.
- `resume_snapshot`:
  - `warm_and_cold_snapshots_agree_past_two_thousand`: a 2,100-message history. A cold
    `get_resume_snapshot`, then a warm one, are equal, and both hold every message.
  - `first_live_revision_extends_the_snapshot_prefix`: after a cold snapshot of 2,100,
    one live append through the event-handler sink emits a `DisplayRevision` whose
    first `n` messages equal the snapshot's.
  - `crossing_two_thousand_raises_no_resync`: a recording surface over 2,001 appends that
    mix assistant, user (`store_user_message`), tool-result and compaction sees zero
    `ChatSurfaceEvent::Resync`.
- `offload`:
  - `a_working_chat_is_never_offloaded`: spawned, idle past a tiny threshold,
    `process_state = Working`. The registry cell and cache remain.
  - `a_cold_opened_chat_sends_without_resync`: `get_messages`, then `send_message`, emits
    no `Resync`.
  - the existing `resend_from_an_attached_chat_after_offload_resyncs_instead_of_scrambling_order`
    still passes.
  - `worktree_missing_error_keeps_the_loaded_history`: a cold chat with history and
    `worktree_missing`. After `send_message`, `get_messages` holds the history plus the
    error.

**Verification.**

```sh
cargo test -p mainframe-chat message_cache
cargo test -p mainframe-chat chat_manager::tests
cargo test -p mainframe-chat idle_
cargo test -p mainframe-chat
```

#### R2 streaming flag, frozen overlay timestamp, throttle meta (`mainframe-chat`, `mainframe-acp`, `mainframe-server`)

**Files.**
- `mainframe-chat/src/event_handler/partial_overlay.rs` (`started_at`);
- `mainframe-chat/src/event_handler.rs` (`emit_display_for` computes `streaming`);
- `mainframe-chat/src/chat_surface.rs` (the `DisplayRevision.streaming` field);
- every `DisplayRevision` construction or match:
  - `event_handler/{chat_surface_tests,partial_overlay_tests}.rs`;
  - `partial_overlay_tests/teardown_tests.rs`;
  - `mainframe-server/src/acp_ws/hub/tests.rs`;
  - `mainframe-server/tests/support/facade.rs`;
- `mainframe-acp/src/encoder.rs` (`encode_revision`);
- `encoder/{accum,content}.rs` (the segment streaming mark);
- `mainframe-acp/src/throttle.rs` (`try_merge_chunk` meta);
- `mainframe-server/src/acp_ws/hub/handlers.rs` (`handle_display_revision`);
- new `mainframe-acp/src/encoder/tests/streaming_tests.rs`, registered in `encoder/tests.rs`;
- `throttle` tests.

**Tests (red first).**
- `partial_overlay_tests`:
  - `the_streaming_flag_rides_the_overlay_and_drops_on_commit`: a partial gives
    `streaming == Some(Text)`; a completed `on_message` gives `None`.
  - `a_thinking_partial_streams_as_thinking`.
  - `the_overlay_timestamp_is_frozen_at_the_first_partial`. The cache ends with a user
    message, so the overlay opens its own group, and that group's base, which supplies
    the `DisplayMessage.timestamp`, is the overlay itself. Two partials 20 ms apart then
    give the same last `DisplayMessage.timestamp`. This fixture fails before the fix. If
    the overlay merged into an earlier assistant group, that group's committed timestamp
    would mask the bug.
  - `an_overlay_that_strips_to_empty_is_not_streaming`.
- `streaming_tests`:
  - `encode_revision_marks_only_the_overlay_segment`: `[text A, tool T, text B]` with
    `Text` gives `[msg, T, msg-1]`, with `streaming` on `msg-1` only.
  - `a_streaming_thought_marks_the_thought_segment`.
  - `encode_revision_without_streaming_equals_encode`: the same items as `encode` for the
    same input.
  - `commit_keeps_the_segment_id`: `[A, T, B partial]` and then `[A, T, B committed]`
    give the same three ids (`msg`, `T`, `msg-1`).
  - `streaming_ids_match_history`: `encode_revision` of the live sequence equals `encode`
    of the history-reconstructed `DisplayMessage[]`, apart from `streaming`.
- `session_state`: `a_streaming_drop_is_a_meta_patch_in_the_same_diff`. The flagged item,
  then the same content without the flag, gives one `AgentMessage` upsert with `content`
  omitted and the new meta. Adding text and dropping the flag gives one chunk carrying the
  new meta.
- `throttle`: `a_merged_chunk_keeps_the_later_meta`. Two same-id chunks, the second with
  meta `M`, merge into one chunk with meta `M`.
- Hub: `a_live_revision_with_streaming_wires_the_flag`. `DisplayRevision { streaming:
  Some(Text) }` on an attached connection produces a creation frame whose
  `_meta["_mainframe.dev"].streaming == true`.

**Verification.**

```sh
cargo test -p mainframe-acp encoder
cargo test -p mainframe-acp throttle
cargo test -p mainframe-acp session_state
cargo test -p mainframe-chat partial_overlay
cargo test -p mainframe-server acp_ws::hub
```

#### R3 creation marker, `replay_complete`, retry-marker carrier (`mainframe-acp`, `mainframe-server`)

**Files.**
- `mainframe-acp/src/session_state/updates.rs` (`create_update` merges the marker);
- `mainframe-acp/src/stream.rs` (`merge_namespace` `pub(crate)`; `retry_marker_carrier`
  accepts only upserts whose `meta` is `Some(Some(_))`);
- `mainframe-server/src/acp_ws/hub.rs` (`reset_session` sends `replay_complete` in both
  arms, and `ResumeSeed.completed`);
- `mainframe-server/src/acp_ws/dispatch/resume.rs` (`deliver_resume` wires `completed`;
  `fail_resume` sends `replay_complete { aborted: true }` when `replied && !completed`);
- tests in `session_state/tests.rs`, `stream/tests.rs`, `resume/tests.rs`,
  `hub/tests/{resume_race_tests,awaiting_seed_tests,gate_tests}.rs`,
  `dispatch/resume/tests.rs` and `mainframe-server/tests/acp_ws_integration.rs`.

Existing assertions that will change:
- exact-meta assertions on creation frames gain `"created": true`;
- every frame-sequence assertion over a resume gains `replay_complete` after `queue_state`
  (or after the reply in the session-gone arm). The affected files are:
  - `hub/tests/resume_race_tests.rs`;
  - `hub/tests/awaiting_seed_tests.rs`;
  - `hub/tests/gate_tests.rs`;
  - `mainframe-server/tests/acp_ws_integration.rs`;
  - the e2e `facade-*` specs, which G-final updates.

**Tests (red first).**
- `session_state`:
  - `only_creations_carry_the_created_marker`: create, chunk, meta-only, full revision,
    clear and tool patch. Only the create and the tool create have `created == true`.
  - `a_replay_create_carries_the_marker`: `dispatch_resume` from `start` stamps every
    item frame.
- `stream`:
  - `a_retry_marker_never_replaces_a_full_meta_with_marker_only`. A retry pending, then a
    full-revision upsert with unchanged meta (wire `meta` absent): the marker waits for the
    next upsert with a full meta, and no frame wires a namespace holding only
    `attempt`/`reason`.
  - Existing T16 tests stay green.
- `resume_race_tests`:
  - `replay_complete_follows_queue_state_and_precedes_catch_up`. The frames are, in order:
    reply, item creates, `state_update`, `queue_state`, `replay_complete`, then the
    buffered revision's frames.
  - `a_reply_to_a_dropped_session_is_followed_by_replay_complete`: the frames are reply,
    then `replay_complete`.
- `awaiting_seed_tests`: `buffered_ops_drain_after_replay_complete` for a raw and a
  revision buffered during the await.
- `dispatch/resume/tests`:
  - `a_failure_after_the_reply_closes_the_replay_before_the_resync`: a panic after the
    reply produces `replay_complete` with `aborted: true`, then `resync`.
  - `a_normal_close_carries_no_aborted_key`: the seeded arm's marker has no `aborted`
    field.
  - `a_failure_before_the_reply_sends_no_replay_complete`.

**Verification.**

```sh
cargo test -p mainframe-acp
cargo test -p mainframe-server acp_ws
cargo test -p mainframe-server --test acp_ws_integration
cargo test -p mainframe-server --test live_vs_cold_reload_golden
```

**Rust group exit.** All of these pass:

```sh
cargo fmt --check
cargo clippy -p mainframe-types -p mainframe-chat -p mainframe-acp -p mainframe-server --all-targets -- -D warnings
cargo test -p mainframe-types -p mainframe-chat -p mainframe-acp -p mainframe-server
cargo check
```

### UI group (after C0; tasks in order, one owner)

Paths below are under `packages/ui/src/`.

#### U1 strict accumulator and origin

**Files.**
- `features/chat/view-model/acp-item-accumulator.ts`: the `{ strictCreation }` option,
  the `ApplyOutcome` return, `origin`, and the `replaying` flag;
- `features/chat/view-model/__tests__/acp-item-accumulator.test.ts`.

**Tests (red first).** In strict mode:
- a chunk, a meta-only upsert, a revision upsert, a `tool_call_update` without the marker,
  and a `tool_call_content_chunk`, each for an unknown id, return `needs-replay` and leave
  `itemsInOrder` empty;
- a marked message create, and a marked tool create (`title: 'Read'`), create items in
  order;
- a marked create for a known id replaces it in place, at the same index;
- a clear for a known id deletes it; a clear for an unknown id returns `ignored`;
- an item created while `replaying` has `origin: 'replay'`; one created live has
  `origin: 'live'`; a later chunk keeps the origin.

In legacy mode, the existing suite passes unchanged.

**Verification.**

```sh
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/view-model/__tests__/acp-item-accumulator.test.ts
```

#### U2 staged replay, `replay_complete`, needs-replay routing

**Files.**
- `lib/daemon/acp-notification-router.ts`: `ReplayCompleteListener` and `onReplayComplete`.
- `lib/daemon/acp-client.ts`: `onReplayComplete`. Expose `mainframeCapabilities` on the
  port.
- New `features/chat/controller/acp-transcript-store.ts` and `acp-replay-window.ts`.
- `features/chat/controller/acp-session-attachment.ts`: the port gains `onReplayComplete`
  and `capabilities`; the subscription generation; the window FIFO lifecycle on every path
  (open, close, abort, clear); `reattach({ wipe })`; the resync and gap aborts.
- `features/chat/controller/acp-full-replay.ts`: the wipe and resync variants pass `wipe`;
  `ReplayCancelledError` is a quiet end, and `inFlight` is always cleared in `finally`;
  rewrite the module doc.
- `features/chat/controller/acp-session-plane.ts`: use the store; route `needs-replay`.
  Keep the file under 300 lines.
- `features/chat/controller/__tests__/acp-test-kit.ts`: `makeFakeAcpClient({ capabilities })`
  and `emitReplayComplete`. Capabilities default to legacy, so the existing suites stay
  unchanged.
- Tests in `lib/daemon/__tests__/acp-notification-router.test.ts`, a new
  `controller/__tests__/acp-session-attachment-staged.test.ts`, and
  `chat-thread-controller-reconcile.test.ts`. Re-express the resync case there in the
  staged mode.

**Tests (red first).** All with both capabilities on.
- `a full replay publishes once at replay_complete`: visible items stay the prior three
  through ten staged creates. After `emitReplayComplete`, there is exactly one
  `transcript.updated` from the replay, carrying ten messages.
- `resync keeps the visible transcript until the replay completes`: no
  `transcript.cleared`, and the item count stays 3 until the end.
- `resync is busy until replay end`: a second resync before `replay_complete` produces no
  second `resume` call.
- `an aborted replay_complete keeps the visible transcript and retries`: staged creates,
  then `replay_complete { aborted: true }`, give no publish (the visible items stay the
  prior three), then one more resume after 1,000 ms.
- `a count mismatch still publishes and only warns`: `itemCount: 5` with 4 creates
  publishes 4 items and logs one `console.warn`.
- `a resync inside the window aborts it`: no publish, and one follow-up resume after
  backoff.
- `detach between request and reply settles resume and leaves FullReplayRetry idle`. A
  resync starts a replay, `detach()` runs before the reply, and the reply then resolves.
  `resume()` settles, no window opens, and a later resync after reactivation issues a new
  `resume` call, which proves `inFlight` was cleared.
- `frames after a gap abort never reach the visible accumulator`. A full window opens and
  receives 2 creates. A gap fires, and the remaining 3 creates arrive before
  `replay_complete`. The visible items stay the prior three, and none of the five replay
  ids is appended at their tail.
- `a second reply opens a second window, and markers close them oldest first`. A full and
  then a cursor resume are both answered before either marker. The first marker publishes
  the full window, and the second closes the cursor window.
- `socket death clears the window FIFO`: both pending `resume()` promises settle, and a
  marker that arrives later with an empty FIFO is ignored.
- `a mid-turn full replay leaves getLastSettledItemId() null`. The replay's
  `state_update` is `running`, and after publish the settled cursor is `null`.
- `an idle replay sets the cursor to the last staged item`: the replay's `state_update` is
  `idle`, and the cursor is the last staged id, not a visible one.
- `a live update after replay_complete lands on the published transcript in order`.
- `an unknown-id chunk with no resume pending requests one bounded resync`. Between a
  resume's request and its window closing, the same chunk requests none.
- `transcript_cleared still wipes immediately`: `transcript.cleared` is dispatched before
  `resume`.
- `a cursor resume marks its items replay-origin and does not stage`.
- `without replayComplete the legacy reset-at-reply path is unchanged` (the existing
  tests).
- Router: `_mainframe.dev/replay_complete` routes `{sessionId}`.

**Verification.**

```sh
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/daemon/__tests__/acp-notification-router.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/acp-session-attachment-staged.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/acp-session-attachment.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/acp-session-attachment-replay.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/acp-session-plane.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-controller-reconcile.test.ts
```

#### U3 part status, stop signal, smoothing tests

**Files.**
- `features/chat/view-model/convert-acp-item.ts`: part and message status; no id fallback.
- `features/chat/controller/project-messages.ts`.
- `features/chat/controller/handle-daemon-event.ts` (the `facadeAttached` input) and
  `chat-event-router.ts` (its host supplies it).
- `features/chat/controller/acp-session-plane.ts`: the `RUN_STOP_SETTLE_MS` deferred stop
  and `cancelPendingStop()`.
- `features/chat/controller/acp-chat-controller.ts`: supplies `facadeAttached`, and calls
  `cancelPendingStop()` before forwarding any `run.started`.
- `features/chat/runtime/chat-extras.ts`: `isRunningFromState` treats a pending gate as
  not running.
- `features/chat/zones/ChatZone.tsx` and `features/side-chat/SideChatPanel.tsx`: use
  `isRunningFromState`.
- Tests in `view-model/__tests__/convert-acp-item.test.ts`,
  `controller/__tests__/project-messages.test.ts`,
  `controller/__tests__/handle-daemon-event.test.ts` and
  `controller/__tests__/acp-session-plane.test.ts`.
- New `features/chat/parts/__tests__/streaming-smooth.test.tsx`, ported from
  `/tmp/mf-smooth/smooth.test.tsx`. Same harness: `useExternalStoreRuntime` with a
  pre-built `messageRepository`, `MarkdownTextPrimitive` with the default `smooth`, fake
  timers for Date, setTimeout and rAF, and a `setImmediate` flush after every rerender.
  Its input comes from real `convertAcpItems` and `projectChatThreadMessages` output.

**Tests (red first).**
- `convert-acp-item`:
  - an item with `streaming: true` yields a text part with `status.type === 'running'`
    and a `running` message;
  - a replay-origin item yields `complete` parts;
  - a replay-origin item that is also `streaming: true` yields a `running` part, so
    streaming wins;
  - `[text, tool, text]` items give parts `['text', 'tool-call', 'text']`;
  - a tool item without a title gets `toolName: 'Unknown tool'` and never its id.
- `project-messages`:
  - `cancelling` keeps the current turn's tail running;
  - idle history is never running;
  - the fallback never stamps an assistant message that a user message follows;
  - a streaming container keeps its own `running` without the fallback.
- `handle-daemon-event`:
  - with `facadeAttached: true`, `chat.updated isRunning:false` gives `noop`;
  - with `facadeAttached: false`, it still gives `run.stopped`;
  - `isRunning:true` gives `run.started`.
- `acp-session-plane` and `acp-chat-controller`:
  - idle dispatches `run.stopped` only after 50 ms;
  - within those 50 ms, each of these cancels the stop: a facade `running`, the optimistic
    `run.started` sent through `chat-actions.ts`, and a `chat.updated isRunning:true`;
  - `dispose` cancels it.
- `chat-extras`: a pending permission makes `isRunningFromState` false.
- `streaming-smooth`:
  1. a part created by a live streaming frame mounts empty and reveals progressively;
  2. a replayed running-thread tail shows its full text at once (no retype);
  3. a final snippet followed immediately by idle animates and completes, given the settle
     delay. The same sequence with an immediate stop pops, which documents the race;
  4. in `[text, tool, text]` only the streaming last text animates; the first text is
     static;
  5. flipping to complete mid-reveal does not cut it short.

**Verification.**

```sh
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/view-model/__tests__/convert-acp-item.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/project-messages.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/handle-daemon-event.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/acp-session-plane.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/parts/__tests__/streaming-smooth.test.tsx
pnpm --filter @qlan-ro/mainframe-ui typecheck
```

**UI group exit.** All of `src/features/chat` passes as single-file runs (not one combined
run, which hits cross-file `React.act` failures), and the UI typecheck is clean.

### G-final e2e, changeset, follow-ups (after both groups)

**E2E: one mock-adapter spec (batched).**
- New recording `packages/e2e/fixtures/recordings/text-tool-text-stream.0.ndjson`:
  1. `onMessagePartial` `msg_S` text;
  2. `onMessage` with that text plus a `Read` tool use;
  3. `onToolResult`;
  4. `onMessagePartial` `msg_S` second text;
  5. `onMessage` with the second text;
  6. `onResult`.
- New spec `packages/e2e/tests-tauri/facade-streaming-segments.spec.ts`. Its wire half
  covers:
  - every first frame carries `created: true`;
  - the overlay item's create has `streaming: true`, and a later frame drops it;
  - the item order is `msg_S`, the tool id, `msg_S-1`;
  - after `session/resume` from `start`, `replay_complete` arrives after `queue_state`.

  Its UI half covers:
  - one assistant message whose parts render text, the Read card, then text;
  - the card title is `Read`;
  - the final text is visible after `waitForIdle`.
- Update every existing `facade-*` spec that asserts the frames after a resume or a
  connect, so `replay_complete` is expected after `queue_state`:
  `facade-protocol.spec.ts`, `facade-protocol-partial.spec.ts`,
  `facade-protocol-streaming.spec.ts`, `facade-reconnect-mid-stream.spec.ts` and
  `facade-queued-prompt.spec.ts`.

Commands:

```sh
pnpm --filter @qlan-ro/mainframe-e2e build:app:tauri
E2E_MODE=mock MF_E2E_SKIP_BUILD=1 pnpm --filter @qlan-ro/mainframe-e2e exec playwright test --project=tauri tests-tauri/facade-streaming-segments.spec.ts tests-tauri/facade-protocol-partial.spec.ts tests-tauri/facade-protocol-streaming.spec.ts tests-tauri/facade-reconnect-mid-stream.spec.ts tests-tauri/facade-protocol.spec.ts tests-tauri/facade-queued-prompt.spec.ts
```

**Changeset** `.changeset/long-chat-streaming.md`:

```md
---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

Long chats no longer replay old turns at the bottom of the transcript, and streamed replies animate only the text that is actually arriving.
```

Extend the body in plain language: no per-chat cap, no fabricated tool cards, replays swap
in at once, and the last snippet animates before the turn ends.

**PR notes.**
- Mobile needs its own facade PR (`packages/mobile` is untouched).
- `_mainframe.dev/resync` stays on the wire.

**Follow-up todos.** File them in the todos plugin (`docs/guides/issue-tracker.md`) with the
`needs-triage` label, once the PR is up:
1. **Phase 2: incremental display projection.** Each revision re-runs
   `prepare_messages_for_client` and `encode` over the whole cache. With no cap that cost
   grows with chat length, at 20 partials per second per attached chat.
2. **Phase 3: revision-versioned resume cursors**, replacing `lastSettledItemId`.
3. **Codex `item/agentMessage/delta` streaming** through the overlay, so Codex items get
   `streaming`.
4. **Reasoning-part smoothing.** Reasoning parts get statuses now, but the Reasoning
   renderer does not smooth.
5. **Mobile facade follow-up.** Handle `created` (strict accumulator), `replay_complete`
   (staged replay), `ItemMeta.streaming`, and the two capability flags. `resync` stays.
6. **Unspawned registry cells are never offloaded**, so their pinned caches persist until
   end, archive or discard. Examples: created but never sent chats, failed spawns, and the
   REST `/resume`.
7. **The resume snapshot omits the partial overlay.** A full replay mid-stream publishes
   without the in-flight text, which reappears on the next partial (at most about 150 ms).
8. **Text either side of a hidden-category tool call coalesces into one segment with no
   separator** (`content.rs` `push_text`).

## Risks

- **Version skew.** An older daemon has neither capability, so the client stays on the
  legacy path. A newer client against an older daemon must never use strict mode. Only the
  advertised flags select it, so test both modes.
- **Per-revision cost grows without the cap.** `emit_display_for` clones the full cache
  for every partial. Measure a 5,000-message chat while streaming during QA. If it
  degrades visibly, raise Phase 2's priority. Do not reintroduce a cap.
- **The settle delay.** A stop deferred by 50 ms is invisible, but every test that asserts
  an immediate `run.stopped` after idle must advance timers.
- **The gate-time `isRunning` choice (finding 9)** is visible UX. Confirm it before merge.

## Exit gates

- Every test named above failed before its change and passes after it.
- The Rust and UI group exit commands pass, and the e2e command passes.
- The changeset is present, and the follow-up todos are filed.
- No new file exceeds 300 lines, and no function exceeds 50. `acp-session-plane.ts` and
  `acp-session-attachment.ts` stay under 300 lines through the extracted store and window
  modules.
- The invariants hold, each with a named test:
  - retention is invisible: `crossing_two_thousand_raises_no_resync`,
    `warm_and_cold_snapshots_agree_past_two_thousand`;
  - patches never fabricate: the U1 suite;
  - no mixed replay generations: `a full replay publishes once at replay_complete`;
  - replay never animates: `streaming-smooth` 2;
  - the final snippet animates: `streaming-smooth` 3;
  - gate behavior is unchanged: the existing `awaiting_seed_tests` gate cases and
    `acp-session-plane-gates.test.ts`.
