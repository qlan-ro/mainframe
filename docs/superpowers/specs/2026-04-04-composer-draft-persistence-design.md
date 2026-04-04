# Composer Draft Persistence

Restore per-chat composer draft persistence so text, attachments, and sandbox captures survive chat switches. Clean up drafts when chats are archived.

## Problem

Commit `c328c9c` added a draft persistence system (module-level `Map<string, Draft>`) that saved and restored composer state across the key-based React remount triggered by chat switching. Commit `c3c97ed` accidentally removed all draft code during a branch-manager PR.

The `key={chatId}` prop on `ChatContainer` (CenterPanel.tsx:99) causes full unmount/remount of the entire chat component tree on every chat switch, destroying the assistant-ui runtime and all composer state.

Additionally, archived chats should have their drafts discarded to avoid stale state accumulating in the Map.

## Design

### New module: `composer-drafts.ts`

Location: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/composer-drafts.ts`

```ts
interface Draft {
  text: string;
  attachments: Array<{ type: string; name: string; contentType?: string; content: unknown[] }>;
  captures: Array<Omit<Capture, 'id'>>;
}

const drafts = new Map<string, Draft>();

export function getDraft(chatId: string): Draft | undefined;
export function saveDraft(chatId: string, draft: Draft): void;
export function deleteDraft(chatId: string): void;
```

Simple get/set/delete wrappers around the module-level Map. The `Capture` type is imported from the sandbox store.

### ComposerCard changes

**On mount** (`useEffect` with `[chatId]`):
- Check `getDraft(chatId)`. If a draft exists, restore text via `composerRuntime.setText()`, attachments via `composerRuntime.addAttachment()`, and captures via `useSandboxStore.getState().addCapture()`.
- Use `requestAnimationFrame` to delay restoration until the composer runtime is ready.

**On unmount** (cleanup return of the same `useEffect`):
- Read `composerRuntimeRef.current.getState()` for text and attachments.
- Read `useSandboxStore.getState().captures` for sandbox captures.
- If any content exists, call `saveDraft(chatId, { text, attachments, captures })`.
- Call `useSandboxStore.getState().clearCaptures()` so captures don't leak to the next chat.
- Use refs (`composerRuntimeRef`, `chatIdRef`) to capture current values for the cleanup closure.

**On successful send** (SendButton onClick):
- Call `deleteDraft(chatId)` after `composerRuntime.send()`.

### Archive cleanup

Call `deleteDraft(chatId)` in the `.then()` callback after `archiveChat()` succeeds in:

1. `FlatSessionRow.tsx` — after `removeChat(chat.id)`
2. `ProjectGroup.tsx` — after `removeChat(chatId)`
3. `MainframeRuntimeProvider.tsx` — after `removeChat(threadId)` in `onArchive`

### What is NOT stored

- Drafts are in-memory only. They do not survive app restart.
- Draft text is not reactive — no Zustand, no context. Only ComposerCard reads/writes.

## Files changed

| File | Change |
|------|--------|
| `composer/composer-drafts.ts` | New module (~20 lines) |
| `composer/ComposerCard.tsx` | Add save/restore/delete lifecycle (~30 lines) |
| `panels/FlatSessionRow.tsx` | Add `deleteDraft()` call on archive |
| `panels/ProjectGroup.tsx` | Add `deleteDraft()` call on archive |
| `assistant-ui/MainframeRuntimeProvider.tsx` | Add `deleteDraft()` call on archive |

## Testing

- Unit test for `composer-drafts.ts`: get/set/delete Map operations.
- Integration test: verify draft survives a chat switch (mount → type → unmount → remount → text restored).
- Integration test: verify draft is cleared after successful send.
- Integration test: verify draft is cleared on archive.
