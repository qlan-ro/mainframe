# New-Session Button on Worktree Rows

**Status:** Approved · **Date:** 2026-04-21

## Summary

Add a `Plus` icon button to each worktree row in the Branches popover, immediately before the existing Trash icon. Clicking it creates a new Claude chat already attached to that worktree.

## Motivation

The Branches popover recently gained the ability to delete a worktree. Users who keep one worktree per feature routinely want the inverse — *start working* in a worktree — and currently have to: open the sidebar, create a chat, then attach the worktree via a separate path. This button collapses that into one click from the place the user is already thinking about worktrees.

## UI

### Placement

In `packages/desktop/src/renderer/components/git/BranchList.tsx`, inside `WorktreeSection`, add a button **before** the existing `Trash2` button in the section header:

```
[chevron] WORKTREE-NAME                       [+]  [trash]
```

### Visibility

Shown only when the parent passes `onNewSession`. The main worktree section (rendered at `BranchList.tsx:269` with no action props) keeps showing neither button — the main project already has its own "new chat" button in the sidebar.

### Styling

- Icon: lucide `Plus`, size 11 (matches `Trash2`).
- Classes: `p-1 mr-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-foreground transition-colors`.
  (Note: `Trash2` hovers to `text-mf-destructive`; `Plus` should hover to `text-mf-foreground` — not a destructive action.)
- Tooltip: "New session on this worktree".
- `aria-label`: `` `New session on worktree ${name}` ``.

## Client action

In `packages/desktop/src/renderer/components/git/useBranchActions.ts`, add:

```ts
handleNewSession: (worktreeDirName: string, branchName: string | undefined) => Promise<boolean>;
```

Implementation sketch:

1. Call the existing `getProjectWorktrees(projectId)` to resolve the row's display name to the real worktree `path` (same approach already used by `handleDeleteWorktree` at `useBranchActions.ts:286`).
2. If no match found → `toast.error` and bail.
3. Call `daemonClient.createChat(projectId, 'claude', getDefaultModelForAdapter('claude'), undefined, { worktreePath: match.path, branchName })`.
4. No explicit navigation: the WS `chat.created` event propagates through `ws-event-router.ts`, which calls `chats.setActiveChat(newChatId)` and opens a tab (same path as every other `chat.create`).
5. `toast.success(\`Started new session on worktree '${worktreeDirName}'\`)`.
6. Call `onClose()` (already passed to `BranchPopover`) so the popover dismisses after the action, matching the UX of a branch switch.

## Server: extend `chat.create`

### Schema

In `packages/core/src/server/ws-schemas.ts`, extend `ChatCreate`:

```ts
const ChatCreate = z.object({
  type: z.literal('chat.create'),
  projectId: z.string().min(1),
  adapterId: z.string().min(1),
  model: z.string().optional(),
  permissionMode: permissionModeSchema,
  worktreePath: z.string().min(1).optional(),
  branchName: z.string().min(1).optional(),
});
```

Both new fields are optional; existing clients are unaffected.

### Plumbing

- `packages/core/src/server/websocket.ts:109` — pass `event.worktreePath` and `event.branchName` into `chats.createChatWithDefaults`.
- `packages/core/src/chat/chat-manager.ts:137` — forward them to `lifecycle.createChatWithDefaults`.
- `packages/core/src/chat/lifecycle-manager.ts:63` — accept them and pass through to `createChat`.
- `packages/core/src/chat/lifecycle-manager.ts` `createChat(...)` — set `chat.worktreePath` and `chat.branchName` on the new `Chat` record when provided.

The CLI spawn path at `lifecycle-manager.ts:297` already reads `chat.worktreePath ?? project.path`, so no adapter changes are required. This is the same mechanism `forkToWorktree` relies on.

### Desktop client

`packages/desktop/src/renderer/lib/client.ts:136` — extend:

```ts
createChat(
  projectId: string,
  adapterId: string,
  model?: string,
  permissionMode?: PermissionMode,
  attachWorktree?: { worktreePath: string; branchName?: string },
): void
```

The new optional arg keeps every existing call site working.

## Validation & error handling

- WS Zod schema rejects empty strings on either new field.
- No server-side verification that `worktreePath` is a real worktree of the project — the UI only constructs this path from `getProjectWorktrees()`, so the path is trusted in-process. A malicious WS client could send an arbitrary path, but that is not a new attack surface: the existing `attach-worktree` REST endpoint already accepts an arbitrary string without cross-checking against `git worktree list`. If we want to harden later, we add the same registered-worktree check used by `delete-worktree` (see `worktree.ts:33`). Out of scope for this change.
- If the CLI spawn fails because the worktree path vanished between the click and spawn (race), the existing `chat.updated` error path surfaces it the same as any other spawn failure. No special handling.

## Testing

### Core (vitest)

Extend or add to `packages/core/src/__tests__/chat/lifecycle-manager.test.ts`:

- `createChatWithDefaults({ worktreePath, branchName })` persists both fields on the chat.
- Omitted fields → chat has neither (regression check for existing callers).

Extend `packages/core/src/server/routes/__tests__/` or WS route tests to cover the new schema fields round-tripping through the handler.

### Desktop (vitest + testing-library)

Extend `packages/desktop/src/renderer/components/git/__tests__/useBranchActions.test.ts` (or create if missing):

- `handleNewSession` resolves path via `getProjectWorktrees` and calls `daemonClient.createChat` with `attachWorktree: { worktreePath, branchName }`.
- When no worktree matches the dir name → toast.error; `createChat` not called.

### Manual

- Create a throwaway worktree, open the popover, click `+` on its row → a new chat tab opens, `/pwd` in that chat resolves to the worktree path.
- Confirm the main worktree row does **not** show the `+` (or the `Trash`).
- Confirm clicking the section title (not the icons) still expands/collapses.

## Regression risks

- **Existing `chat.create` callers**: all must continue to work with the new fields omitted. Covered by the "omitted → neither set" test.
- **CLI spawn path**: already honors `chat.worktreePath`; used by `forkToWorktree` every day. No change.
- **Popover layout with many worktrees**: two icons + tooltips in a narrow row — visually verify spacing. Fallback is `mr-1` gap between icons.

## Out of scope

- Choosing a different adapter/model per click (always `claude` + its default).
- Server-side validation that the supplied `worktreePath` is a registered git worktree of the project.
- Any change to the main-worktree row's controls (the "new chat" button already lives in the sidebar).
