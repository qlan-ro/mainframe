# File Tree: Worktree Paths + Symlink Support

Fixes todo #98 (bug, high) and #96 (feature, medium). Both are file-tree scoped, shipped together.

## Problem 1 — Copy Path / Reveal in Finder broken in worktrees (#98)

`packages/desktop/src/renderer/components/panels/FilesTab.tsx:204-205` builds the absolute path for context-menu actions from `activeProject.path` (the project root). When a chat has a worktree, the file tree already lists entries from the worktree path (backend resolves via `getEffectivePath`; the header also shows `activeChatWorktreePath ?? activeProject.path`). So the context menu produces paths pointing to files under the main project tree that may not exist, or that are the wrong copy.

**Fix:** Use `activeChatWorktreePath ?? activeProject.path` as the base in `handleContextMenu`. Add `activeChatWorktreePath` to the `useCallback` dependency list. "Copy Relative Path" is unchanged — it was never wrong.

## Problem 2 — Symlinks appear as files (#96)

`packages/core/src/server/routes/files.ts:33-45` (`handleTree`) classifies each `Dirent` via `isDirectory() ? 'directory' : 'file'`. For a symlink, `Dirent.isDirectory()` and `isFile()` both return false, so every symlink (to a file or a directory) is labelled as a file and can't be expanded.

**Fix:** When `e.isSymbolicLink()` is true, `stat()` the resolved path to learn whether the target is a file or directory, and classify accordingly. If the target cannot be stat'd (broken/dangling symlink) or resolves outside `basePath`, skip the entry (same treatment as `walkProjectFiles` in `fs-utils.ts`). Resolve symlinks in parallel with `Promise.all` so one slow stat doesn't serialize the listing. No UI change — symlinked directories just become expandable.

## Non-goals

- No symlink icon/indicator in the tree.
- No change to `handleSearchFiles` / `handleFilesList` — they walk dirs themselves and already rely on `resolveAndValidatePath` (which uses realpath).
- No change to `Copy Relative Path`.

## Testing

- **#98:** manual — open a chat with a worktree, right-click an entry, verify Copy Path and Reveal in Finder point at the worktree's copy.
- **#96:** unit test for `handleTree` against a tmp dir containing (a) a symlink to a file, (b) a symlink to a directory, (c) a broken symlink, (d) a symlink pointing outside the project. Assert classification and that out-of-scope/broken symlinks are omitted.

## Risk

Low. Both changes are local — no cross-package API changes, no DB/schema touch, no event-pipeline change.
