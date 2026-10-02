# Todo #385: per-window replay staging (short-form plan)

**Route:** no-spec, follow-up to PR #735 (merged). **Size:** expected source diff around 150 lines across seven files in `packages/ui/src/features/chat/controller/`, so this is the short form: one implementation group, with TDD inline.

## Goal

Each replay window owns its replay storage. A full window owns its staging accumulator and its deferred `state_update`. A cursor window owns its replay-origin marking of the visible accumulator. Frames still route by FIFO order. They go to the window at the front of the FIFO, never to a single shared slot. Opening, aborting, completing, draining or clearing one window cannot replace, publish or discard another window's data. Wire ordering, generation guards, capability-gated legacy behavior and bounded resync retries stay as they are.

## Design

- **`ReplayStage`** is a new small class in `acp-replay-stage.ts`. It holds `full: boolean`, `accumulator: AcpItemAccumulator | null` (null for cursor stages), `pendingState: state_update | null`, and a one-way status `open → published | discarded`. The store creates stages, and windows own them.
- **`AcpTranscriptStore`** replaces `staging`, `isStaging`, `target()`, `beginFullReplay`/`beginCursorReplay`/`endCursorReplay`, `publishStaging` and `discardStaging` with:
  - `openStage(full)`. A full stage gets a fresh accumulator with `setReplaying(true)`. The store remembers every open stage.
  - `apply(update, stage | null)`. A full stage applies to its own accumulator, whatever its status, so an aborted window keeps absorbing frames. Anything else applies to `visible` after calling `visible.setReplaying(stage !== null && !stage.full)`. Replay-origin is derived per frame from the routed window, so it is no longer a flag that one window sets and another window's publish clobbers.
  - `publish(stage)`. This only acts on an open full stage. It swaps the stage's accumulator in as `visible`, calls `setReplaying(false)`, clears `firstSeenAt`, marks the stage published and returns its items. In every other case it returns `null`, so a duplicate or stale call is a no-op.
  - `discard(stage)`. This marks the stage discarded. It is idempotent.
  - `resetAll()`. This builds a new visible accumulator and marks every open stage discarded. A window opened before a wipe still absorbs its remaining frames but can never publish pre-wipe content.
- **`ReplayWindow`** gets a `stage: ReplayStage | null` field. Refused windows have no stage.
- **`ReplayCoordinatorHost` / `AcpSessionAttachmentHost`**:
  - `beginReplay({ full })` returns a `ReplayStage`.
  - `completeReplay(stage)` and `discardReplay(stage)` take the window's own stage instead of `{ full }`.
  - The coordinator gets `currentStage()`, which returns `fifo.front()?.stage ?? null`. The attachment passes it through as `currentReplayStage()`.
  - Every site that releases a window releases that window's own stage: `cancelAll`, `cancelStaleConnection`, an aborted window's marker, and a daemon `aborted` marker.
- **`AcpSessionPlane`** drops `pendingReplayState`. `handleUpdate` reads `attachment.currentReplayStage()`, applies through `store.apply`, and captures `state_update` into `stage.pendingState` when the routed stage is full. `completeReplay(stage)` publishes. When it gets items back, it refreshes from them once and applies that stage's own `pendingState` against those same items. To support this, `applyStateUpdate` takes the published items explicitly. For live frames, the default is still `store.accumulator`. `discardReplay(stage)` calls `store.discard`. `resetAccumulator` calls `store.resetAll()`.

## Files

- New: `controller/acp-replay-stage.ts`
- `controller/acp-transcript-store.ts`, `acp-replay-window.ts`, `acp-replay-coordinator.ts`, `acp-session-attachment.ts`, `acp-session-attachment-types.ts`, `acp-session-plane.ts`. The listeners file is unchanged.
- Tests:
  - New ownership suite, `controller/__tests__/acp-replay-stage-ownership.test.ts`. A new file is needed because `acp-session-attachment-staged.test.ts` is already 1045 lines.
  - Fix-ups in `__tests__/acp-attachment-support.ts`. Its `beginReplay` mock must return a stage.
  - Fix-ups in `acp-session-attachment-staged.test.ts`. Change `toHaveBeenCalledWith({ full: true })` to match on the stage. Update the "single-staging-slot limitation" comment in the finding-7 test.
- `.changeset/<name>.md`: a `@qlan-ro/mainframe-ui` patch. Use user-facing wording, for example: "Overlapping transcript reloads no longer interfere with each other."

## TDD (inline, red before green)

Write the ownership suite first, at plane level with the fake client and the `STAGED` capabilities. Confirm each case fails, or cannot be expressed, against the shared slot. Then implement. Cases:

1. **Separate staging.** Open two full windows A and B, for example with two overlapping gap resumes and a null settled cursor using deferred replies. A's marker publishes only A's frames, and B's marker publishes only B's.
2. **Abort or close of the older window spares the newer.** A gap-abort of A, or a daemon `aborted` marker for A, leaves B's staging intact, and B publishes on its own marker.
3. **Full/cursor overlap.** Test both orders. When a cursor window is in front of a full window, the cursor's frames apply visibly and are replay-origin, while the full window's frames stay staged. When a full window is in front of a cursor window, the cursor's frames after the full publish land on the published accumulator as replay-origin. Items created after the cursor window closes are live-origin.
4. **Stale connection cleanup.** Draining a stale-connection window discards only its own stage, and a current-generation window still publishes.
5. **State follows the published window.** A captures `idle` and B captures `running`. A's publish settles the cursor to A's last item and schedules a stop. B's publish then starts the run, without a cross-over of state.
6. **Clear.** A full window that is open at `transcript_cleared` never publishes pre-wipe frames. The wipe's own reattach still publishes once.
7. **Duplicate or stale completion.** Calling `completeReplay` or `discardReplay` on a stage that was already published or discarded dispatches nothing.

Existing contracts must keep passing unchanged in meaning: abort, refused-empty replay, duplicate marker, detach, clear, single-publication, the legacy no-capability path, and the finding-2 origin test.

## Risks

- **Frames with no window.** Frames that arrive between a resume request and its reply, while the FIFO is empty, apply to `visible` without replay-origin. This is unchanged from today's behavior and stays in scope only as a regression check.
- **Cursor-stage discard.** Discarding a cursor stage is now a store no-op, because replay-origin is per frame. Today a daemon-aborted cursor marker calls `endCursorReplay`. That effect is preserved because the next visible apply re-derives the flag.
- **Size limits.** `acp-session-plane.ts` is at 296/300. Removing `pendingReplayState` and simplifying the begin and discard paths must keep it at or under 300. If it does not, move the replay callbacks into a helper rather than compressing them. Functions must stay at or under 50 lines.
- **Out of scope.** Wire multiplexing, untagged interleaved frames (FIFO order remains the routing contract), UI, mobile and cursor protocol.

## Established facts

- PR #735 is merged (merge commit `54a31fbb`) and is part of this branch's base. Receipt: `gh pr view 735`. `git log origin/main..HEAD` was empty before this plan.
- Replay-origin is decided at item creation from the accumulator's `replaying` flag. Receipt: `view-model/acp-item-accumulator.ts`, `setReplaying` and the creation-origin helper.
- Frames belong to the oldest queued window, whatever its status. Receipt: `acp-replay-window.ts`, `ReplayWindowFifo.front`.
- A window is pushed only after its `resume()` reply resolves. Receipt: `acp-replay-coordinator.ts`, `ReplayWindowCoordinator.openWindow`.
- Today, a cursor `beginReplay` nulls the plane's shared `pendingReplayState`, and a full publish replaces `visible` with `replaying=false`, which drops an overlapping cursor window's replay-origin. Receipt: `acp-session-plane.ts`, `beginReplay`/`completeReplay`, and `acp-transcript-store.ts`, `publishStaging`.
- Today, `target()` returns any open staging ahead of `visible`, so a cursor window in front of a newer full window has its frames routed into the full window's staging. Receipt: `AcpTranscriptStore.target`.
- `transcript_cleared` calls `resetAccumulator` and then `fullReplay.requestWipe()`. Receipt: `acp-session-listeners.ts`, the `onTranscriptCleared` handler.
- The fake client already supports `emitGap`, `emitReplayComplete(sessionId, aborted)` and `bumpConnectionGenerationSilently`. Receipt: `__tests__/acp-test-kit.ts`, `FakeAcpClient`.
- The 300-line file and 50-line function limits come from `docs/DEVELOPER-GUIDE.md` (the "File size limit" / "Function size limit" bullets).

## Exit gates (end of the single group)

- The new ownership suite and every existing `controller/__tests__` suite pass under vitest.
- `packages/ui` typecheck and repo lint are clean.
- No source file exceeds 300 lines and no function exceeds 50 lines.
- A grep finds no remaining references to `isStaging`, `target()`, `publishStaging`, `discardStaging`, `beginCursorReplay`, `endCursorReplay` or `pendingReplayState`.
- The changeset is present.
