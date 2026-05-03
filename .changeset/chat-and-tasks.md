---
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-desktop": minor
---

feat: chat rendering + adapter event pipeline improvements (#133 #141 #142 #144)

- **#133** Add canonical `normalizeTodos` utility (`todos/normalize.ts`) supporting `todoV1` (TodoWrite), `taskV2` (TaskCreate/TaskUpdate/TaskStop), and `codexTodoList` sources. Wire V2 task events into Claude adapter's `onTodoUpdate` so `chat.todos` reflects V2 task progress. Add 17 tests covering all sources and edge cases.
- **#141** Fix thinking indicator disappearing prematurely: Claude CLI emits `result` events for subagent (Task/Agent) turns carrying `parent_tool_use_id`; these were being routed to `onResult()` which flipped `processState` to `'idle'` while the parent session was still working. Subagent result events are now dropped at the event handler level. Add 3 regression tests.
- **#142** Add Find-in-Chat: `Cmd+F` / `Ctrl+F` while the chat thread is focused slides down a find bar with live-filter (80ms debounce), match counter, prev/next navigation, and `Esc` to close. Implemented via `FindBar.tsx` and `find-in-chat` zustand store.
- **#144** Fix Codex `todoList` items silently dropped: `TodoListItem` was defined in types but missing from both the `ThreadItem` union and the `item/completed` switch. Added the union member and a `todoList` case that normalizes items via `onTodoUpdate`. Add 3 tests.
