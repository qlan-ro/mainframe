# Launch Config Auto-Refresh

## Problem

The launch configuration dropdown (`useLaunchConfig` hook) reads `.mainframe/launch.json` once on mount and on project switch. When the `/launch-config` command generates the file via the AI agent, the dropdown stays empty until the user manually reloads with CMD+R.

## Solution

Add two refresh triggers to `useLaunchConfig`, mirroring the pattern established in `FilesTab`:

1. **`context.updated` WebSocket event** — the daemon already emits this when the agent uses Write/Edit tools (via `trackFileActivity` in `event-handler.ts`). Subscribe via `daemonClient.onEvent()`, debounced 500ms, scoped to the active chat.

2. **Window `focus` event** — catches manual edits to `launch.json` made outside the app.

Both triggers increment a `refreshKey` counter that causes the existing file-read `useEffect` to re-execute.

## Scope

**Single file changed:** `packages/desktop/src/renderer/hooks/useLaunchConfig.ts`

No new event types. No core changes. No new dependencies.

## Design Details

- `refreshKey` state (number, starts at 0) added as dependency to the existing `useEffect` that reads `launch.json`.
- `activeChatId` obtained via `useChatsStore((s) => s.activeChatId)` — the hook does not currently have this dependency and must add it.
- `context.updated` listener subscribes when `activeChatId` is set; unsubscribes on cleanup. Cleanup must call both `unsub()` and `clearTimeout(debounceRef.current)` to prevent post-unmount state updates.
- Debounce (500ms) prevents rapid-fire reads during burst tool-use sequences. Window focus is not debounced (consistent with FilesTab pattern — focus events are infrequent and reads are cheap IPC).
- Window focus listener is unconditional (no chat dependency). When no chat is active, only the focus path triggers re-reads.
- `launch.json` is <1KB — re-reading on unrelated `context.updated` events is negligible overhead.

## Testing

- Unit test: verify `useLaunchConfig` re-reads after `refreshKey` changes (mock `window.mainframe.readFile`).
- Manual: run `/launch-config` in a chat, confirm dropdown populates without CMD+R.
