# Per-Row Spinner While Deleting a Worktree

**Status:** Approved · **Date:** 2026-04-21

## Summary

While a worktree delete is in flight, swap the row's trash icon for a `Loader2` spinner and disable both the trash and new-session (`+`) buttons on that row. Other rows stay interactive. On success the row unmounts via the existing branch refetch; on error the icon reverts.

## Motivation

Users currently get no feedback while a worktree deletion is in progress. For remote or slow filesystems the operation can take a noticeable moment; without feedback it looks like the click was ignored. Showing a spinner on the clicked row gives immediate, row-local feedback.

## UI

**Trash button:** when its row is the one being deleted, render a lucide `Loader2` icon with `animate-spin` in place of `Trash2`. Size 11 (same as the existing icon). Keep the outer button's existing `aria-label` — the icon swap is visual only.

**Plus button on the same row:** while the trash is in its spinner state, set `disabled` on the `+` button so the user cannot start a new session on a worktree that is about to vanish.

**Other worktree rows:** unchanged and interactive.

**Disabled styling:** match the existing `disabled` pattern already used in the codebase (`opacity-40 cursor-not-allowed`, see `BranchPopover.tsx` fetch button). Apply it via a conditional class, same approach.

## State wiring

Reuse the existing `busyAction` plumbing rather than introducing a parallel `deletingWorktree` field. The hook already tags in-flight actions with a string (`'fetch'`, `'updateAll'`) and downstream components already check `busyAction === 'fetch'` to animate the fetch icon.

1. **`useBranchActions.handleDeleteWorktree`** passes `` `deleteWorktree:${worktreeDirName}` `` as the second arg to `withBusy`.
2. **`BranchPopover`** forwards `actions.busyAction` into `<BranchList busyAction={...} />`.
3. **`BranchList`** forwards `busyAction` into each `<WorktreeSection busyAction={...} />`.
4. **`WorktreeSection`**:
   - `const isDeleting = busyAction === \`deleteWorktree:${name}\``.
   - If `isDeleting`, render `<Loader2 size={11} className="animate-spin" />` instead of `<Trash2 size={11} />`.
   - Set `disabled={isDeleting}` on both the `+` and trash buttons of that row.

The tag string choice (`deleteWorktree:<name>`) matches the existing tag style and encodes which row is deleting without adding a second piece of state.

## Why not a dedicated `deletingWorktree: string | null`

The existing `busyAction` already tracks "what's being done right now" and is exposed on the hook's return object. A parallel field would duplicate responsibility and risk them drifting out of sync. Single source of truth.

## Testing

Add one test to `packages/desktop/src/__tests__/components/git/useBranchActions-new-session.test.tsx` — or a sibling file `useBranchActions-delete-worktree.test.tsx` — asserting that `handleDeleteWorktree` passes the `` `deleteWorktree:<name>` `` action tag to `withBusy` (verified by observing `busyAction` during the await).

No new tests needed at the `BranchList`/`WorktreeSection` level: the icon swap is trivial markup driven by a prop, and the existing `BranchPopover.test.tsx` renders with `worktrees: []` (so the spinner path is never exercised in snapshot tests anyway).

## Scope

| File | Change |
|---|---|
| `packages/desktop/src/renderer/components/git/useBranchActions.ts` | One-line: pass action tag string to `withBusy` in `handleDeleteWorktree`. |
| `packages/desktop/src/renderer/components/git/BranchList.tsx` | Add `busyAction?: string | null` to `BranchListProps` + `WorktreeSection` props. Conditional `Loader2` vs `Trash2`. Conditional `disabled` on both icons. Import `Loader2` from lucide. |
| `packages/desktop/src/renderer/components/git/BranchPopover.tsx` | Forward `busyAction={actions.busyAction}` to `<BranchList>`. |
| `packages/desktop/src/__tests__/components/git/useBranchActions-delete-worktree.test.tsx` | New: handler sets the correct busyAction tag; clears after completion. |

## Regression risks

- **Global `busy` gating of fetch/updateAll still works**: `busy` is a boolean separate from `busyAction`; this change doesn't touch `busy`.
- **Other worktree rows**: the row's `busyAction` check is string-equality on `deleteWorktree:<name>` — only that specific row's name matches.
- **`busyAction` shape**: currently `'fetch' | 'updateAll' | null`. This change introduces a new prefix pattern (`deleteWorktree:<name>`). Any consumer doing exhaustive checks on the enum would need updating. Spot check: only `BranchPopover` reads `busyAction` today, and it uses equality checks (`=== 'fetch'`) — unaffected by the new prefix.

## Out of scope

- Changing the delete API itself (the call remains a REST POST with existing response shape).
- Adding a separate "undo" affordance.
- Optimistic removal of the row before the server confirms.
