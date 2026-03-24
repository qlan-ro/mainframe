# Branch Management — Design Spec

## Overview

Add a branch management popover to the status bar. Clicking the branch name opens an Xcode-style dropdown with branch listing, search, and git operations: checkout, create, fetch, push, pull, merge, rebase, rename, delete. Introduces `simple-git` as the git interface, replaces existing `execGit` usage in route handlers, and adds a reusable toast notification system.

## Decisions

- **User-facing UI only.** No agent/plugin API for git operations in this iteration.
- **Project root only.** All operations target the project's main working directory, not chat worktrees.
- **Conflict surfacing, not resolution.** Merge/rebase conflicts are detected and displayed (file list + abort). No inline conflict editor.
- **`simple-git` over raw `execGit`.** Handles output parsing, error detection, and conflict identification. The existing `execGit` read endpoints are migrated to use the new service.

## Part 1: GitService

New module `packages/core/src/git/git-service.ts`. Uses a per-project mutex to prevent concurrent git operations on the same working directory.

```ts
class GitService {
  static forProject(projectPath: string): GitService;

  // Read operations (replacing existing execGit-based endpoints)
  currentBranch(): Promise<string>;
  status(): Promise<StatusResult>;
  branches(): Promise<BranchListResult>;
  diff(options: DiffOptions): Promise<string>;
  branchDiff(base?: string): Promise<BranchDiffResult>;

  // Write operations (new)
  checkout(branch: string): Promise<void>;
  createBranch(name: string, startPoint?: string): Promise<void>;
  fetch(remote?: string): Promise<FetchResult>;
  pull(remote?: string, branch?: string): Promise<PullResult>;
  push(branch?: string, remote?: string): Promise<PushResult>;
  merge(branch: string): Promise<MergeResult>;
  rebase(branch: string): Promise<RebaseResult>;
  abort(): Promise<void>;  // auto-detects merge vs rebase
  renameBranch(oldName: string, newName: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<DeleteResult>;
  updateAll(): Promise<UpdateAllResult>;
}
```

### Concurrency

A per-project mutex (keyed by absolute project path) ensures write operations are serialized. Read operations do not acquire the lock. If a write operation is already in progress for a project, subsequent write requests wait in queue. This prevents corrupted state from concurrent checkout + pull or similar.

### Abort auto-detection

`abort()` checks for `.git/MERGE_HEAD` (merge in progress) or `.git/rebase-merge`/`.git/rebase-apply` (rebase in progress) and calls the appropriate `git merge --abort` or `git rebase --abort`. If neither is found, returns a no-op.

### Branch name validation

Branch names are not validated with a regex. Instead, git itself validates on create/rename — the service catches the error and returns it as a structured response. This avoids reimplementing git's complex branch naming rules.

### Update All algorithm

`updateAll()` runs `git fetch --all` then `git pull` on the current branch only (fast-forward if possible). It does NOT switch branches. Other local tracking branches are updated only via the fetch (their remote-tracking refs are updated, but the local branch pointer stays where it is). This avoids dirty-tree issues and is fast.
```

### Result types

Defined in `packages/types/src/git.ts`:

```ts
type BranchInfo = {
  name: string;        // e.g., "fix/release-race"
  current: boolean;
  tracking?: string;   // e.g., "origin/fix/release-race"
};

type BranchListResult = {
  current: string;
  local: BranchInfo[];
  remote: string[];    // e.g., ["origin/main", "origin/feat/plugin-system"]
};

type FetchResult = {
  status: 'success';
  remote: string;
};

type PullResult =
  | { status: 'success'; summary: { changes: number; insertions: number; deletions: number } }
  | { status: 'up-to-date' }
  | { status: 'conflict'; conflicts: string[]; message: string };

type MergeResult =
  | { status: 'success'; summary: { commits: number; insertions: number; deletions: number } }
  | { status: 'conflict'; conflicts: string[]; message: string };

type RebaseResult =
  | { status: 'success' }
  | { status: 'conflict'; conflicts: string[]; message: string };

type PushResult =
  | { status: 'success'; branch: string; remote: string }
  | { status: 'rejected'; message: string };

type DeleteResult =
  | { status: 'success' }
  | { status: 'not-merged'; message: string };

type UpdateAllResult = {
  fetched: boolean;
  pull: PullResult;  // result of pulling current branch
};
```

### Migration

All existing endpoints are migrated to `GitService` and moved under the `/git/` prefix for consistency:

| Old path | New path |
|----------|----------|
| `GET /api/projects/:id/git/branch` | `GET /api/projects/:id/git/branch` (unchanged) |
| `GET /api/projects/:id/git/status` | `GET /api/projects/:id/git/status` (unchanged) |
| `GET /api/projects/:id/branch-diffs` | `GET /api/projects/:id/git/branch-diffs` |
| `GET /api/projects/:id/diff` | `GET /api/projects/:id/git/diff` |

Same response shapes, different internals. Desktop callers are updated to use the new paths. `execGit` is removed from route handlers — kept only as an internal escape hatch inside `GitService` if `simple-git` doesn't cover a particular operation.

## Part 2: REST Endpoints

All new endpoints in `packages/core/src/server/routes/git.ts` (extending existing file). All validate input with Zod. All resolve the project path from the DB — never trust client-supplied paths.

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| `GET` | `/api/projects/:id/git/branches` | — | List all branches (local + remote) |
| `POST` | `/api/projects/:id/git/checkout` | `{ branch }` | Switch branch |
| `POST` | `/api/projects/:id/git/branch` | `{ name, startPoint? }` | Create branch |
| `POST` | `/api/projects/:id/git/fetch` | `{ remote? }` | Fetch from remote |
| `POST` | `/api/projects/:id/git/pull` | `{ remote?, branch? }` | Pull branch |
| `POST` | `/api/projects/:id/git/push` | `{ branch?, remote? }` | Push branch |
| `POST` | `/api/projects/:id/git/merge` | `{ branch }` | Merge branch into current |
| `POST` | `/api/projects/:id/git/rebase` | `{ branch }` | Rebase current onto branch |
| `POST` | `/api/projects/:id/git/abort` | — | Abort merge or rebase (auto-detects) |
| `POST` | `/api/projects/:id/git/rename-branch` | `{ oldName, newName }` | Rename branch |
| `POST` | `/api/projects/:id/git/delete-branch` | `{ name, force? }` | Delete branch |
| `POST` | `/api/projects/:id/git/update-all` | — | Fetch all + pull current branch |

Existing read endpoints are migrated under `/git/` prefix (see Migration section above).

### chatId handling

New write endpoints do NOT accept a `chatId` parameter — they always operate on the project root. Existing read endpoints (`GET /git/branch`, `GET /git/status`) continue to accept `chatId` for worktree-aware display. The popover calls the new endpoints without `chatId`; the status bar continues to use the existing branch endpoint with `chatId` so worktree branches display correctly.

## Part 3: Desktop API Client

New functions in `packages/desktop/src/renderer/lib/api/git-api.ts`:

```ts
getGitBranches(projectId): Promise<BranchSummary>;
gitCheckout(projectId, branch): Promise<void>;
gitCreateBranch(projectId, name, startPoint?): Promise<void>;
gitFetch(projectId, remote?): Promise<FetchResult>;
gitPull(projectId, remote?, branch?): Promise<PullResult>;
gitPush(projectId, branch?, remote?): Promise<PushResult>;
gitMerge(projectId, branch): Promise<MergeResult>;
gitRebase(projectId, branch): Promise<RebaseResult>;
gitAbort(projectId): Promise<void>;
gitRenameBranch(projectId, oldName, newName): Promise<void>;
gitDeleteBranch(projectId, name, force?): Promise<DeleteResult>;
gitUpdateAll(projectId): Promise<UpdateAllResult>;
```

Existing `getGitBranch` and `getGitStatus` in `files-api.ts` are migrated to `git-api.ts`.

## Part 4: UI — Branch Popover

### Location

Status bar branch name becomes clickable. Click opens a popover anchored above it.

### Popover structure

```
┌─────────────────────────────────────┐
│ ⑂ fix/unify-release-workflow  ▾     │  ← current branch header
├─────────────────────────────────────┤
│ [Search branches…]  [Fetch] [Push]  │  ← search + action buttons
├─────────────────────────────────────┤
│ + New Branch…                ⌘⇧N   │
│ ↻ Update All                        │
├─────────────────────────────────────┤
│ LOCAL BRANCHES                      │
│  ▾ fix                              │
│    ⑂ unify-release-workflow  ▸      │  ← current (highlighted)
│    ⑂ release-race            ▸      │  ← click → submenu
│  ▾ feat                             │
│    ⑂ plugin-system           ▸      │
│    ⑂ assistant-ui            ▸      │
│  ★ main                     ▸      │
├─────────────────────────────────────┤
│ ▸ REMOTE BRANCHES                   │  ← collapsible
└─────────────────────────────────────┘
```

### Branch submenu (click a branch row)

Appears to the right of the clicked branch.

**On a non-current branch:**
- New Branch from '{name}'…
- ---
- Checkout
- Pull
- Push
- ---
- Merge into Current Branch
- Rebase Current Branch onto This
- ---
- Rename…
- Delete Branch (red)

**On the current branch:**
- New Branch from '{name}'…
- ---
- ~~Checkout~~ (disabled)
- Pull
- Push
- ---
- ~~Merge into Current Branch~~ (disabled)
- ~~Rebase Current Branch onto This~~ (disabled)
- ---
- Rename…
- ~~Delete Branch~~ (disabled)

### Top-level actions

- **Fetch button** (next to search): runs `git fetch --all`. Updates remote-tracking refs for all remotes.
- **Push button** (next to search): pushes the current branch to its tracking remote.
- **New Branch…**: opens the new branch sub-view.
- **Update All**: runs `git fetch --all` then `git pull` on the current branch. Equivalent to Fetch + Pull on the current branch in one click.

Per-branch Pull and Push in the submenu target that specific branch (e.g., Push on a non-current branch pushes that branch's local ref to its tracking remote without switching to it).

### Search

Filters branches by substring match as user types. Groups collapse if no children match. If no match at all, show "No matching branches".

### Branch tree grouping

Branches are grouped by `/`-delimited prefix (e.g., `fix/`, `feat/`). Branches without a prefix (like `main`) render at the top level. Groups are collapsible.

### New Branch sub-view

Replaces popover content when "New Branch…" or "New Branch from…" is selected:
- Back arrow (←) to return to main view
- Branch name input
- "Start from" branch picker (defaults to current branch, or the clicked branch for "New Branch from…")
- Cancel / Create buttons

### Conflict state

When the project is in a merge/rebase conflict state, the popover shows:
- Red warning header: "Merge conflicts" / "Rebase conflicts"
- Abort button
- List of conflicting files with `C` indicator
- Help text: "Resolve conflicts in your editor, then commit. Or abort to undo."

Status bar branch name shows a ⚠ indicator when in conflict state.

### Popover behavior

- Opens above the status bar, anchored to the branch name
- Closes on click-outside or Escape
- Closes after successful checkout (branch changed). The client immediately re-fetches the branch name to update the status bar (no 15s poll delay).
- Stays open after fetch/push/pull (refreshes branch list)

## Part 5: Toast Notification System

Reusable toast system for the entire app. Not specific to branch management.

### Store

Zustand store in `packages/desktop/src/renderer/store/toasts.ts`:

```ts
type Toast = {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
};

type ToastStore = {
  toasts: Toast[];
  add(type: Toast['type'], message: string): void;
  dismiss(id: string): void;
};
```

### API

Helper in `packages/desktop/src/renderer/lib/toast.ts`:

```ts
toast.success('Pulled 3 commits on main');
toast.error('Push rejected: non-fast-forward');
toast.info('Fetching from origin…');
```

### Component

`<Toaster />` mounted at the app root. Fixed position bottom-right. Toasts stack vertically, click to dismiss early. Max 5 visible. Auto-dismiss: success and info toasts at 4 seconds, error toasts persist until manually dismissed (they often contain actionable information).

### Optimistic UI locking

All git action buttons (Fetch, Push, Pull, Merge, Rebase, etc.) disable themselves while an operation is in-flight. This prevents double-click issues. A spinner replaces the button icon during loading. The branch list shows a skeleton on initial load.

## Part 6: Safety Guards

### Dirty working tree

Before checkout: check `git status`. If uncommitted changes exist, show confirmation dialog. If git refuses the checkout (conflicting changes), surface the error via toast.

Before merge/rebase: same warning about uncommitted changes.

### Branch deletion

- Current branch: action disabled in submenu
- Not fully merged: show warning "Branch '{name}' is not fully merged. Delete anyway?" with confirm/cancel
- Never force-delete without explicit user confirmation

### Push rejection

If push is rejected (non-fast-forward), surface git's error message via toast. No auto-force-push.

### Conflict state lock

When in merge/rebase conflict state:
- Disable checkout, merge, rebase in submenus
- Only allow abort, pull, push, rename, new branch
- Status bar shows ⚠ indicator

## Part 7: Testing

### Unit tests (GitService)

- Mock `simple-git` — test each method returns correct structured results
- Test conflict detection for merge and rebase
- Test error handling: invalid branch names, network failures, non-existent branches

### Integration tests (REST endpoints)

- Zod validation: bad input rejected with 400
- Project resolution: non-existent project → 404
- Mock GitService to test endpoint logic in isolation

### Component tests (Desktop)

- BranchPopover: renders branch list, search filtering, submenu on click, disabled states for current branch
- Toast: renders, auto-dismisses, stacks, dismiss on click
- NewBranchDialog: validates input, calls API on submit

### E2E

No E2E tests for branch management in this iteration. Git operations require a real repository with specific state, making E2E unreliable without significant fixture setup. A placeholder note is added to `packages/e2e/` documenting this gap.

## Non-goals

- Agent/plugin API for git operations
- Worktree-scoped branch management
- Inline conflict resolution editor
- Git log / commit history viewer
- Stash management