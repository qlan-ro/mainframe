# File Tree Refresh on Agent Changes

## Problem

When an agent session writes, deletes, or renames files, the Files tab in the right panel does not update. Users must switch projects/chats or re-expand directories to see changes. This breaks the feedback loop during active agent sessions.

## Solution

Subscribe FilesTab to the existing `context.updated` WebSocket event (already emitted by the daemon when session file changes are detected). Debounce rapid events and re-fetch all currently expanded directories.

## Scope

- **In scope:** Agent-driven refresh via `context.updated`, debouncing, preserving expand/collapse state.
- **Out of scope:** OS-level file watching (external editor changes), auto-reveal of new files, persistent expand state across tab switches.

## Design

### Mechanism

A `refreshKey` counter in `FilesTab` increments on debounced `context.updated` events. Both the root fetch and each expanded `FileTreeNode` include `refreshKey` in their `useEffect` dependency arrays, triggering re-fetches.

### Data flow

```
Agent writes file
  -> Daemon emits context.updated (existing behavior)
  -> FilesTab receives event, starts 500ms debounce timer
  -> Additional writes reset the timer
  -> Timer fires -> refreshKey++
  -> Root useEffect fires -> re-fetches root entries
  -> Each expanded FileTreeNode useEffect fires -> re-fetches its children
  -> Tree UI updates
```

### Changes

**File: `packages/desktop/src/renderer/components/panels/FilesTab.tsx`**

This is the only file modified.

1. Import `daemonClient` from `../../lib/client`.
2. Add `refreshKey` state (number, starts at 0).
3. Add a `useRef` for the debounce timer (matches ContextTab pattern).
4. Add `useEffect` subscribing to `context.updated` events, with 500ms trailing debounce. The handler must guard `event.chatId === activeChatId` before triggering. Dependencies: `[activeChatId]`.
5. Add `refreshKey` to the root entries fetch `useEffect` dependency array.
6. Pass `refreshKey` as a prop to each `FileTreeNode`.
7. In `FileTreeNode`: add `useEffect` on `refreshKey` that (a) re-fetches children if the node is currently expanded, and (b) clears cached children if the node is collapsed but was previously loaded. This ensures re-expanding a collapsed directory after a refresh always fetches fresh data.

### Debounce behavior

- 500ms trailing debounce groups rapid file writes into a single refresh.
- The debounce timer is cleaned up in the `useEffect` cleanup function, preventing stale refreshes on chat/project switches or unmount.

### Edge cases

- **Tab not visible:** FilesTab unmounts when another right panel tab is active. No event listener, no wasted fetches.
- **No active chat:** The subscription effect guards on `activeChatId`. No listener when no session is active.
- **Collapsed directories with cached children:** On `refreshKey` change, cached children are cleared. The next expand triggers a fresh fetch rather than showing stale data.
- **Collapsed directories never expanded:** Unaffected. They fetch fresh data on first expand as they do today.
- **Rapid project/chat switches:** Debounce timer cleaned up in effect cleanup.

### What doesn't change

- No new WebSocket events, daemon changes, or type additions.
- No global state or new Zustand store.
- Context menu, file opening, expand/collapse behavior unchanged.

## Future extensions

- **OS-level file watching:** Add `chokidar` or `fs.watch` in the daemon, emit a new `files.changed` event. FilesTab would subscribe to both events.
- **Auto-reveal new files:** Parse file paths from tool results, walk the tree to auto-expand parent directories and highlight new entries.
- **Change indicators:** Show a dot badge on collapsed directories that contain unseen changes.
