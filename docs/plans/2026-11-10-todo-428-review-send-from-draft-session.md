# Todo #428: send file review comments from a draft session

Size S. One implementation group, TDD inline.

## Goal

In a draft session (a `__LOCALID_*` "New Session" with no messages yet), clicking "Submit review" or sending a single comment from the editor or diff viewer should create the daemon chat from the draft's config and send the formatted review as its first user message. Comments are cleared only after a successful send. A failed send keeps every comment and shows an error toast. A send with no active session keeps the comments and shows a toast. Sends from an existing session or a side chat stay as they are.

## Approach

`useSendReview` (`packages/ui/src/features/editor/inline-comments/use-send-review.ts`) gets three cases:

1. **Existing session or side chat**: `useActiveIdentity().chatId` is set. No change: `chatControllerRegistry.getOrCreate(chatId, port).sendMessage(message)`.
2. **Draft**: no `chatId`, and `useActiveDraftConfig()` returns a config. Run `await <active thread-list item>.initialize()`. This goes through the native seam (`chatsRemoteAdapter.initialize` → `createForLocal` → `chatControllerRegistry.adopt`), and aui stamps the item's `remoteId`, so the tab and sidebar row flip to a normal session. Then `await chatControllerRegistry.getOrCreate(remoteId, port).sendMessage(message)`. Errors from either step propagate to the caller. Use the same item binding that `useActiveIdentity` reads (`aui.threadListItem`). Fall back to `aui.threads.item('main')` only if that binding turns out to be unbound where the editor is mounted.
3. **No session**: no `chatId` and no draft config. Return `'no-session'`.

The `SendReviewOutcome` union stays `'sent' | 'no-session' | 'empty'`. A failure is a rejected promise.

`useReviewActions` (`use-review-actions.ts`), in both `handleSubmitReview` and `handleSendOne`:
- Clear notes **only** when the outcome is `'sent'`. Today the `catch` falls through and clears notes after a rejected send. That breaks the failure acceptance criterion, so this is a bug fix too.
- On rejection, call `mfToast.error(...)` (from `@/lib/toast`) with the error message as the description, and keep the notes.
- On `'no-session'`, call a toast telling the user to open a session first. Use `warning` or `info`, whichever is closer to the copy convention nearby. Keep the notes.

## Files touched

- `packages/ui/src/features/editor/inline-comments/use-send-review.ts`
- `packages/ui/src/features/editor/inline-comments/use-review-actions.ts`
- `packages/ui/src/features/editor/inline-comments/__tests__/use-send-review.test.ts`: add a draft case (initialize called, message sent to the adopted remote id, `'sent'` returned), an initialize-rejects case, a sendMessage-rejects case, and a no-draft no-session case. Keep the existing cases.
- A review-actions test: extend `__tests__/use-file-tab-notes.test.tsx` (it already mocks `useSendReview`) or add `__tests__/use-review-actions.test.tsx`. It must cover clear on `'sent'`, keep plus error toast on rejection, and keep plus toast on `'no-session'`, for both submit-all and send-one.
- `.changeset/<name>.md`: `"@qlan-ro/mainframe-ui": patch`.

## Risks

- **Double create**: the composer's `onNew` and the native `initialize` both converge on `createForLocal`, which is idempotent per local id. `chatsRemoteAdapter.initialize` also reuses a controller that already has a remote id. If the user types in the composer and sends while a review-triggered initialize is still in flight, it should still create only once. The implementer should keep that true and must not call `createForLocal` directly from the hook, because that skips aui's `remoteId` stamping.
- **Fire-and-forget append**: the brief points at the "thread-runtime append path". That path cannot report failure (see the facts below), so it cannot meet the failure and toast criteria. This plan uses the awaitable initialize seam that the append path triggers, plus the same controller send the existing-session path uses. Reviewers should judge it against the brief's intent, not its wording.
- **Draft composer text**: leave it untouched. The review goes out as its own message.
- **Other mocks**: `MarkdownEditorTab.notes.test.tsx`, `use-comment-gutter.model.test.tsx` and other tests mock `useSendReview` or its outcome. Toast calls in `useReviewActions` may need `@/lib/toast` mocked or tolerated there.
- **Out of scope**: the preview capture sender (`features/preview/use-send-captures.ts`) has the same `chatId` guard. Leave it alone and mention it in the PR as a follow-up.

## Established facts

- `ThreadRuntime.append` drops the promise from `onNew`, so callers cannot observe failure. Receipt: `node_modules/.pnpm/@assistant-ui+core@0.3.12*/.../dist/runtime/api/thread-runtime.js` `append(message)` has no `return`. Also `store/scopes/thread.d.ts` `append(message: CreateAppendMessage): void`.
- `threadListItem.initialize()` returns `Promise<{ remoteId, externalId }>`. Receipt: `@assistant-ui/core/dist/store/scopes/thread-list-item.d.ts` `initialize()`.
- On the thread's first `"initialize"` event, the native seam calls `aui.threadListItem.initialize()`, but only while the item status is `"new"`. That means a later composer send after a review-triggered initialize does not re-initialize. Receipt: `@assistant-ui/core/dist/react/runtimes/RemoteThreadListHookInstanceManager.js` `handleInitialize`.
- The adapter's `initialize` creates the chat via `createForLocal(threadId, port)` and adopts the controller, or reuses `controller.getDaemonId()` if the controller already has a remote id. Receipt: `packages/ui/src/features/sessions/runtime/chats-remote-adapter.ts` `initialize`.
- `createForLocal` builds the chat from the stored draft config (project, worktree, provider, model, tuning), is idempotent per local id while in flight, and rejects when no draft config exists. Receipt: `packages/ui/src/features/sessions/runtime/new-thread-coordinator.ts` `createForLocal` / `runWorkflow` / `newWorkflow`.
- After `adopt`, `chatControllerRegistry.getOrCreate(remoteId, port)` returns the same controller. Receipt: `packages/ui/src/features/sessions/runtime/chat-controller-registry.ts` `adopt`.
- `useActiveIdentity().chatId` is the side-chat id inside a side-chat scope, and otherwise the bound item's `remoteId`, which is undefined for a draft. Receipt: `packages/ui/src/features/sessions/use-active-identity.ts` `useActiveIdentity`.
- `useActiveDraftConfig()` returns the draft config only for a `__LOCALID_*` item with no session custom. Receipt: `packages/ui/src/features/sessions/use-active-draft-config.ts`.
- The repository's toast API is `mfToast.error/warning/info(title, opts)`. Receipt: `packages/ui/src/lib/toast.ts` `mfToast`.
- `useReviewActions` currently clears notes after a rejected send because the `catch` only logs. Receipt: `use-review-actions.ts` `handleSubmitReview` / `handleSendOne`.
- The worktree has no `node_modules`. Run `pnpm install` before running tests.

## Exit gates

- New unit tests fail before the change and pass after it. They cover draft (sent), existing session (unchanged), initialize or send failure (rejects, comments kept, error toast), and no session (comments kept, toast), for both submit-all and send-one.
- Every existing test under `packages/ui/src/features/editor` and `packages/ui/src/features/viewers` still passes, with mocks updated only where the toast import requires it.
- `@qlan-ro/mainframe-ui` typecheck and lint are clean for the touched files.
- A changeset exists for `@qlan-ro/mainframe-ui` (patch).
