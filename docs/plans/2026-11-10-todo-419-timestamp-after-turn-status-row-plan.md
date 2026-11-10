# Todo #419: clock timestamp follows the turn status row

While the turn status row is visible under its anchor message, show that message's clock below the row instead of in the message footer (design direction A). Order: content, footer (action bar and timing), status row, clock. When the row goes away, the clock goes back into the footer. Only one clock renders at any moment. Size S. Keep the source diff under about 150 lines.

## Approach

- Move the row's visibility decision out of `TurnStatusRow` into one thread-level source, for example `thread/turn-status-tail.tsx`. That module owns `useRunningTasks`, `useFinishedFlash`, the `useTurnStatusHost` "hosted" check and `statusAnchorId`, and it produces `{ anchorId, running, tasks, finished, visible }`. `visible` is `running || tasks > 0 || finished > 0`, which is the condition `TurnStatusRow` uses today to return null.
- Compute that value once, in `VirtualMessages`, and pass it down through a React context provider wrapped around the list. Do not compute it in each `MessageTimestamp` or `VirtualMessage`. The finished flash is per-instance state with its own timer. Separate instances could show two clocks or none for a frame. One instance shared by the row, the relocated clock and every footer `MessageTimestamp` rules that out.
- The provider must be thread-level, not per-message. In compact mode, a `footerInDetails` footer renders inside another message's activity details (`CompactMessageSlice.tsx::SourceDetail`), so it sits outside the anchor's `VirtualMessage` subtree. `MessageTimestamp` compares its own `message.id` with `anchorId` and returns null when they match and `visible` is true. With no provider (nested transcripts, isolated tests), it falls back to today's behaviour.
- `TurnStatusRow` reads the shared value and renders the same thing it renders today. Its phase, clock and task segments stay unchanged. The anchor branch of `VirtualMessage` renders `<TurnStatusRow />` and then the relocated clock, which renders only when `visible` is true.
- The relocated clock reuses `MessageTimestamp`'s label, typography and `data-testid="chat-message-timestamp"`. Extract a small presentational piece so the footer and tail cannot drift apart. It reads `createdAt`, the content-empty rule and `role` from `thread.messages[index]`, because it renders outside the message scope. It renders nothing for user-role anchors, since the row follows the user prompt before any reply exists, and nothing for empty or `createdAt`-less messages. Align it with the row's text. When the running segment shows, offset it by the dot plus the gap. When only the background-task segment shows, use no offset.

## Files touched

- `packages/ui/src/features/chat/thread/turn-status-tail.tsx` (new): the shared state hook, provider and selector.
- `packages/ui/src/features/chat/thread/TurnStatusRow.tsx`: consume the shared state. The file shrinks.
- `packages/ui/src/features/chat/thread/VirtualMessages.tsx`: mount the provider and render the relocated clock after the row.
- `packages/ui/src/features/chat/messages/MessageTimestamp.tsx`: hide the anchor's clock while the row is visible, and share the label piece.
- Tests: `thread/__tests__/TurnStatusRow.test.tsx` (wrap in the provider if needed), `thread/__tests__/VirtualMessages-turn-status.test.tsx` or a new sibling, and `messages/__tests__/MessageTimestamp.test.tsx`.
- `.changeset/<new>.md`: a `"@qlan-ro/mainframe-ui": patch` entry.

## Risks

- Two clocks or none during the transition. Mitigate by deriving everything from the single provider value. Test the running → settled change and the background-tasks → flash → gone change with fake timers.
- Remounts. Do not change the element shape around `ThreadPrimitive.MessageByIndex` depending on whether the message is the anchor, or message-local state such as disclosures is lost. The provider lives above Virtuoso, not inside `VirtualMessage`.
- Re-renders. The provider value changes only on `isRunning`, hosted, task-count or flash changes, never on the elapsed tick, because elapsed stays inside `RunningStatus`. Memoise the value.
- Compact anchor whose footer is hidden (`SliceBody` `visible === false`). The relocated clock could appear where the footer would not show. This is accepted for now. Flagged for review.
- E2E: `packages/e2e/tests-tauri/transcript.spec.ts` looks for `chat-message-timestamp` inside the last assistant message after the turn settles. That still holds unless background tasks outlive the turn, and the recorded fixtures do not.

## Established facts

- `TurnStatusRow.tsx::TurnStatusRow` returns null unless `running || tasks || finished`, with `running = isRunning && !hosted` and `tasks = hosted ? 0 : count`. `useFinishedFlash` holds the 1500 ms flash in per-instance ref, state and timer.
- `VirtualMessages.tsx::VirtualMessage` renders `<TurnStatusRow />` right after `ThreadPrimitive.MessageByIndex` when `statusAnchorId(messages) === id`. The verbose path (`ChatThreadViewport.tsx`) and the compact path (`CompactTranscript.tsx`, inside `TurnPresentationProvider`) both mount `VirtualMessages`.
- `turn-phase.ts::statusAnchorId` returns the newest non-queued message, which can be a user message (`VirtualMessages-turn-status.test.tsx`, "follows the user message itself").
- `turn-status-host.ts::useTurnStatusHost` is thread-level, with no per-message dependency. It reads `useOptionalTurnPresentationSelector`, so it returns null in verbose mode.
- `MessageTimestamp` is used in exactly three places: `AssistantMessage.tsx` (the verbose footer), and `CompactMessageSlice.tsx::SourceDetail` (the `footerInDetails` footer, under the source message's `MessagePrimitive` scope) and `SliceBody` (the regular compact footer).
- `MessageTimestamp` hides when `createdAt` is missing or every part is an empty text part (`MessageTimestamp.test.tsx`).

## Exit gates

- Red before green. The new tests fail on the current code and then pass. They cover four cases. (1) Running with a content-bearing anchor: DOM order is content, `chat-turn-status`, `chat-message-timestamp`, and the anchor has no footer clock. (2) Settled: exactly one clock, inside the footer. (3) A non-anchor assistant message keeps its footer clock. (4) A hosted status, with the row stepped aside, keeps the clock in the footer. Run the coverage in both compact and verbose footer paths, or through the shared `MessageTimestamp` gate with one test per footer path.
- The `packages/ui` test suite, typecheck and lint pass. The existing `TurnStatusRow`, `VirtualMessages-*`, `AssistantMessage` and `ChatThread` tests still pass.
- Every touched file stays at or under 300 lines, and every function at or under 50 lines.
- A changeset is added.
