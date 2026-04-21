# Per-Row Spinner While Deleting a Worktree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the trash icon for a spinner (and disable the `+` button) on the specific worktree row being deleted.

**Architecture:** Reuse the existing `busyAction` string pattern (already used for `'fetch'`/`'updateAll'`). Tag delete-in-flight actions with `` `deleteWorktree:${name}` ``; forward `busyAction` through `BranchList` to `WorktreeSection`; `WorktreeSection` renders `Loader2` instead of `Trash2` when its row matches, and disables both row buttons.

**Tech Stack:** React, lucide-react (`Loader2`), Tailwind (`animate-spin`, `opacity-40 cursor-not-allowed`), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-21-worktree-delete-spinner-design.md`

---

## File Structure

**Modify:**
- `packages/desktop/src/renderer/components/git/useBranchActions.ts` — add action tag to existing `handleDeleteWorktree`.
- `packages/desktop/src/renderer/components/git/BranchList.tsx` — accept `busyAction` prop, swap icon, disable buttons.
- `packages/desktop/src/renderer/components/git/BranchPopover.tsx` — forward `busyAction` to `<BranchList />`.

**Create:**
- `packages/desktop/src/__tests__/components/git/useBranchActions-delete-worktree.test.tsx` — handler sets the correct `busyAction` tag during delete and clears it after.

---

## Task 1: Wire the spinner end-to-end

**Files:**
- Modify: `packages/desktop/src/renderer/components/git/useBranchActions.ts:280-299`
- Modify: `packages/desktop/src/renderer/components/git/BranchList.tsx` (props + render)
- Modify: `packages/desktop/src/renderer/components/git/BranchPopover.tsx:232-241`
- Create: `packages/desktop/src/__tests__/components/git/useBranchActions-delete-worktree.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/__tests__/components/git/useBranchActions-delete-worktree.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBranchActions } from '../../../renderer/components/git/useBranchActions';

vi.mock('../../../renderer/lib/api', () => ({
  getGitBranches: vi.fn().mockResolvedValue({ current: 'main', local: [], remote: [], worktrees: [] }),
  getGitStatus: vi.fn().mockResolvedValue({ files: [] }),
  getProjectWorktrees: vi.fn(),
  deleteWorktree: vi.fn(),
  gitCheckout: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitMerge: vi.fn(),
  gitRebase: vi.fn(),
  gitAbort: vi.fn(),
  gitRenameBranch: vi.fn(),
  gitDeleteBranch: vi.fn(),
  gitUpdateAll: vi.fn(),
}));

vi.mock('../../../renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../renderer/lib/client', () => ({
  daemonClient: { createChat: vi.fn() },
}));

vi.mock('../../../renderer/lib/adapters', () => ({
  getDefaultModelForAdapter: vi.fn(() => 'claude-sonnet-4-5'),
}));

import { getProjectWorktrees, deleteWorktree } from '../../../renderer/lib/api';

describe('useBranchActions.handleDeleteWorktree — busyAction tagging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('sets busyAction to `deleteWorktree:<name>` during the delete, clears after', async () => {
    (getProjectWorktrees as any).mockResolvedValue({
      worktrees: [{ path: '/projects/my-repo/.worktrees/feat-x', branch: 'refs/heads/feat-x' }],
    });

    let resolveDelete: () => void = () => {};
    (deleteWorktree as any).mockImplementation(
      () => new Promise<void>((r) => { resolveDelete = r; }),
    );

    const { result } = renderHook(() =>
      useBranchActions('proj-1', undefined, vi.fn(), vi.fn()),
    );

    let deletePromise!: Promise<boolean>;
    await act(async () => {
      deletePromise = result.current.handleDeleteWorktree('feat-x', 'feat-x');
      // Allow the confirm + getProjectWorktrees resolution to flush.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.busyAction).toBe('deleteWorktree:feat-x');

    await act(async () => {
      resolveDelete();
      await deletePromise;
    });

    expect(result.current.busyAction).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- useBranchActions-delete-worktree
```

Expected: FAIL. `result.current.busyAction` is `null` throughout because `handleDeleteWorktree` currently calls `withBusy(fn)` with no action tag.

- [ ] **Step 3: Tag the delete action**

Edit `packages/desktop/src/renderer/components/git/useBranchActions.ts`. Replace the inner `return withBusy(...)` line of `handleDeleteWorktree` (currently at roughly line 286) so it passes an action tag:

Before:
```ts
return withBusy(async () => {
  const { worktrees } = await getProjectWorktrees(projectId);
  // ...
});
```

After:
```ts
return withBusy(async () => {
  const { worktrees } = await getProjectWorktrees(projectId);
  // ... unchanged body ...
}, `deleteWorktree:${worktreeDirName}`);
```

Only that trailing `, `deleteWorktree:${worktreeDirName}`` is new. Do not change anything else inside the handler.

- [ ] **Step 4: Run the test — confirm it passes**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- useBranchActions-delete-worktree
```

Expected: PASS.

- [ ] **Step 5: Add `busyAction` prop to `BranchList` and `WorktreeSection`**

Edit `packages/desktop/src/renderer/components/git/BranchList.tsx`.

**5a.** Update the lucide import (line 2):

```ts
import { ChevronRight, ChevronDown, GitBranch, Star, Trash2, Plus, Loader2 } from 'lucide-react';
```

**5b.** Extend `BranchListProps` — add below `onNewSession`:

```ts
busyAction?: string | null;
```

**5c.** Extend `WorktreeSection` props object. Replace the function signature (currently at roughly lines 151-163) with:

```ts
function WorktreeSection({
  name,
  branches,
  currentBranch,
  onSelectBranch,
  onDeleteWorktree,
  onNewSession,
  busyAction,
}: {
  name: string;
  branches: BranchInfo[];
  currentBranch: string;
  onSelectBranch: (branch: string, isCurrent: boolean, isRemote: boolean) => void;
  onDeleteWorktree?: (worktreeDirName: string, branchName: string | undefined) => void;
  onNewSession?: (worktreeDirName: string, branchName: string | undefined) => void;
  busyAction?: string | null;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const branchName = branches[0]?.name;
  const isDeleting = busyAction === `deleteWorktree:${name}`;
```

**5d.** Replace the two action buttons inside the header `<div className="flex items-center">` (currently the `onNewSession && ...` and `onDeleteWorktree && ...` blocks) so both honor `isDeleting`:

```tsx
{onNewSession && (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        onClick={() => onNewSession(name, branchName)}
        disabled={isDeleting}
        className={cn(
          'p-1 mr-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors',
          isDeleting && 'opacity-40 cursor-not-allowed',
        )}
        aria-label={`New session on worktree ${name}`}
      >
        <Plus size={11} />
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">New session on this worktree</TooltipContent>
  </Tooltip>
)}
{onDeleteWorktree && (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        onClick={() => onDeleteWorktree(name, branchName)}
        disabled={isDeleting}
        className={cn(
          'p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-destructive transition-colors',
          isDeleting && 'opacity-60 cursor-not-allowed',
        )}
        aria-label={`Delete worktree ${name}`}
      >
        {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">{isDeleting ? 'Deleting…' : 'Delete worktree'}</TooltipContent>
  </Tooltip>
)}
```

Note: the `cn` helper is already imported at the top of this file (line 4). The Plus button uses `opacity-40` (matches existing disabled pattern); the Trash button uses `opacity-60` so the spinner stays readable while indicating disabled state.

**5e.** Destructure `busyAction` in `BranchList` and forward it to `WorktreeSection`. Replace the `BranchList` function signature block (currently around lines 210-218):

```tsx
export function BranchList({
  local,
  remote,
  worktrees,
  currentBranch,
  search,
  onSelectBranch,
  onDeleteWorktree,
  onNewSession,
  busyAction,
}: BranchListProps): React.ReactElement {
```

**5f.** Forward the prop in the `worktreeGroups.map(...)` render:

```tsx
{worktreeGroups.map((wt) => (
  <WorktreeSection
    key={wt.name}
    name={wt.name}
    branches={wt.branches}
    currentBranch={currentBranch}
    onSelectBranch={onSelectBranch}
    onDeleteWorktree={onDeleteWorktree}
    onNewSession={onNewSession}
    busyAction={busyAction}
  />
))}
```

- [ ] **Step 6: Forward `busyAction` from `BranchPopover`**

Edit `packages/desktop/src/renderer/components/git/BranchPopover.tsx`. Add `busyAction={busyAction}` to the `<BranchList .../>` element (currently around lines 232-241):

```tsx
<BranchList
  local={branches.local}
  remote={branches.remote}
  worktrees={branches.worktrees}
  currentBranch={branches.current}
  search={search}
  onSelectBranch={handleSelectBranch}
  onDeleteWorktree={actions.handleDeleteWorktree}
  onNewSession={actions.handleNewSession}
  busyAction={busyAction}
/>
```

`busyAction` is already destructured from `actions` in `BranchPopover.tsx` at line 24 — no change needed there.

- [ ] **Step 7: Typecheck and run desktop tests**

```bash
pnpm --filter @qlan-ro/mainframe-desktop build
pnpm --filter @qlan-ro/mainframe-desktop test
```

Expected: build passes, all 388 tests pass (1 new + existing 387).

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer/components/git/useBranchActions.ts \
        packages/desktop/src/renderer/components/git/BranchList.tsx \
        packages/desktop/src/renderer/components/git/BranchPopover.tsx \
        packages/desktop/src/__tests__/components/git/useBranchActions-delete-worktree.test.tsx
git commit -m "feat(branches): per-row spinner while deleting a worktree"
```

- [ ] **Step 9: Add changeset**

Create `.changeset/worktree-delete-spinner.md`:

```markdown
---
'@qlan-ro/mainframe-desktop': patch
---

While a worktree delete is in flight, show a spinner on that row's trash icon and disable both the trash and new-session buttons. Other worktree rows remain interactive.
```

Commit:

```bash
git add .changeset/worktree-delete-spinner.md
git commit -m "chore: changeset for worktree-delete-spinner"
```

---

## Self-Review Checklist

**Spec coverage:**
- UI (Loader2 swap, disable both buttons, disabled styling) → Step 5d.
- State wiring (handleDeleteWorktree tag → BranchList → WorktreeSection) → Steps 3, 5b, 5c, 5e, 5f, 6.
- Testing (handler sets/clears busyAction) → Steps 1-4.
- Regression risks covered: other worktree rows unaffected (string equality on name); `busy` boolean untouched.
- Changeset → Step 9.

**Placeholder scan:** no TBD/TODO/"similar to"/"add error handling" — all steps contain exact code or commands.

**Type consistency:** `busyAction?: string | null` used consistently in `BranchListProps`, `WorktreeSection` props, and forwarded identically from `BranchPopover`. The tag string literal `` `deleteWorktree:${name}` `` is identical in `handleDeleteWorktree` (producer) and `WorktreeSection` (consumer).
