/**
 * react-lexical's `SyncPlugin` tags every runtime → editor sync with this
 * string. It is not exported (`@assistant-ui/react-lexical` 0.2.25,
 * `src/plugins/SyncPlugin.tsx`), so it is copied here, once.
 *
 * One behaviour depends on it: when the runtime empties the field (a send, a
 * quote taking the text), the field clears its undo history, so ⌘Z cannot
 * bring the sent text back. `__tests__/aui-sync-tag.test.tsx` mounts the real
 * `LexicalComposerInput` and fails if an upstream release renames the tag.
 */
export const AUI_SYNC_TAG = 'aui-sync';
