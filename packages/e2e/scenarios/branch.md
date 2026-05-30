# QA Test Scenarios — Branch / Worktree Management

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) B1–B20. Locators:
`.locator('[data-testid="..."]')`. No existing spec — net-new coverage. API under
`/api/projects/:id/git/*`._

**Shared starting conditions:** app launched in Electron, daemon connected, a git project active so
`branch-button` is visible in the status bar.

---

## Scenario B1 — Open / close the branch popover

**Test Objective:** The branch popover opens with the expected default state and closes cleanly.

**Test Steps:**
1. Click `branch-button` → `BranchPopover` mounts; `branch-popover-search-input` autofocused; quick actions (`branch-popover-fetch`, `-new-branch`, `-update-all`, `-push`) visible; local section expanded, remote collapsed.
2. Press Esc → closes. Re-open, click outside → closes.

**Expected Outcomes:**
- `branch-button` absent when project has no git repo.
- A "Working in worktree isolation" banner shows if the active chat has a worktreePath.

---

## Scenario B2 — Search / filter branches

**Test Objective:** Typing filters local and remote branch lists.

**Test Steps:**
1. Type a partial name in `branch-popover-search-input` → matching `branch-row-select-*` shown, others hidden.
2. Clear → all reappear. Type a non-match → "No matching branches".

**Expected Outcomes:**
- Filters local, remote, and prefix-grouped branches by branch name.

---

## Scenario B3 — Expand / collapse sections

**Test Objective:** Local and remote sections toggle independently.

**Test Steps:**
1. Click `branch-list-local-toggle` → local rows collapse; click again → expand.
2. Click `branch-list-remote-toggle` (present only if remotes exist) → remote rows show/hide.

**Expected Outcomes:**
- `branch-list-remote-toggle` rendered only when `remote.length > 0`.

---

## Scenario B4 — Open the branch submenu (local)

**Test Objective:** Selecting a local branch opens its action submenu with correct enablement.

**Test Steps:**
1. Click a non-current `branch-row-select-<name>` → `branch-submenu-dialog` opens with checkout/pull/push/merge/rebase/rename/delete actions.
2. Click the same row again → submenu closes.

**Expected Outcomes:**
- For the **current** branch: checkout, merge, rebase, delete are disabled.
- For a **worktree** branch: checkout, pull, rename, delete are disabled.

---

## Scenario B5 — Checkout a branch

**Test Objective:** Checkout switches branches and updates the status bar.

**Starting Conditions:** submenu open for a non-current, non-worktree branch; clean tree.

**Test Steps:**
1. Click `branch-submenu-item-checkout` → all submenu buttons busy-disable; `POST .../git/checkout`; on success toast "Switched to <branch>", popover closes, `branch-button` label updates.

**Expected Outcomes:**
- Dirty tree → `confirm("You have uncommitted changes. Continue?")`; cancel aborts.
- Failure → error toast, popover stays open.

---

## Scenario B6 — Fetch, push, update-all

**Test Objective:** The three quick remote actions fire their endpoints with busy feedback.

**Test Steps:**
1. Click `branch-popover-fetch` → pulse icon, all actions busy-disabled; `POST .../git/fetch`; toast "Fetched"; list reloads.
2. Click `branch-popover-push` → `POST .../git/push`; toast "Pushed to origin/<branch>".
3. Click `branch-popover-update-all` → spinning icon; `POST .../git/update-all`; summary toast; list reloads.

**Expected Outcomes:**
- Push rejection → "Push rejected: <message>".
- Update-all conflict → view transitions to ConflictView (`conflict-view-dialog`).

---

## Scenario B7 — Create a new branch (quick action)

**Test Objective:** A new branch is created from a chosen start point with client-side validation.

**Test Steps:**
1. Click `branch-popover-new-branch` → `new-branch-dialog`; `new-branch-name-input` autofocused; `new-branch-start-point-select` defaults to current branch.
2. Type a valid name → `new-branch-create` enables → click it → `POST .../git/branch` with `{name, startPoint}`; toast "Created <name>"; returns to list.

**Expected Outcomes:**
- Validation before API: empty → "Branch name is required"; bad chars (`^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$`) → "Invalid branch name"; existing → "Branch already exists".
- `new-branch-back` / `new-branch-cancel` return to list with no API call.

---

## Scenario B8 — Create a branch from a specific branch (submenu)

**Test Objective:** "New Branch from '<x>'" pre-selects the start point.

**Test Steps:**
1. Open a branch submenu → click `branch-submenu-item-new-branch-from-…` → `new-branch-dialog` with `new-branch-start-point-select` pre-set to that branch.
2. Enter a name → `new-branch-create` → `startPoint` is the pre-selected branch.

**Expected Outcomes:**
- Same validation as B7; payload start point differs.

---

## Scenario B9 — Rename a branch

**Test Objective:** A branch renames and the status bar updates if it was current.

**Starting Conditions:** submenu open for a non-current, non-worktree branch.

**Test Steps:**
1. Click `branch-submenu-item-rename` → `RenameView`; `rename-branch-name-input` autofocused, pre-filled.
2. Change the name → `rename-branch-rename` enables → click (or Enter) → `POST .../git/rename-branch`; toast "Renamed to <new>"; returns to list.
3. Alternatively `rename-branch-cancel` / `rename-branch-back` → return to list, no API.

**Expected Outcomes:**
- Rename disabled while name empty/whitespace or while busy.

---

## Scenario B10 — Delete a branch

**Test Objective:** Deleting a branch confirms first and handles the not-merged force path.

**Test Steps:**
1. Open submenu for a merged, non-current, non-worktree branch → click `branch-submenu-item-delete-branch` → `confirm("Delete branch '<name>'?")`.
2. Cancel → no API. Confirm → `POST .../git/delete-branch {force:false}`; toast "Deleted branch '<name>'"; list reloads.

**Expected Outcomes:**
- Not-merged → second `confirm("Force delete?")`; confirm sends `{force:true}`, cancel keeps branch.
- Delete disabled for current/worktree branches.

---

## Scenario B11 — Pull / merge / rebase + conflict handling

**Test Objective:** Pull, merge, and rebase succeed or route to the conflict/abort view.

**Test Steps:**
1. `branch-submenu-item-pull` → `POST .../git/pull`; toast on success.
2. `branch-submenu-item-merge-into-current-branch` → `POST .../git/merge`; toast "Merged <branch> (+N -N)".
3. `branch-submenu-item-rebase-current-onto-this` → `POST .../git/rebase`; toast "Rebase complete".
4. On conflict in any → `conflict-view-dialog` with file list + `conflict-view-abort`; click abort → `POST .../git/abort`; toast "Aborted"; returns to list.

**Expected Outcomes:**
- Pull with no tracking remote → "No tracking remote for <branch>".
- Re-opening the popover during a conflicted state opens directly into the conflict view.

---

## Scenario B12 — Worktree sections in the branch popover (P2)

**Test Objective:** The branch popover's per-worktree sections render and act correctly.

**Test Steps:**
1. With worktrees present, the popover lists `worktree-section-toggle-<name>`, `worktree-section-new-session-<name>`, `worktree-section-delete-<name>`.
2. Click new-session → `createChat` with worktree info; toast "Started new session on worktree '<name>'"; popover closes.
3. Click delete → `confirm(...)` → resolves path → deletes worktree; spinner while deleting; toast on success.

**Expected Outcomes:**
- Worktree-branch submenus disable checkout/pull/rename/delete.

> The session-row worktree pill (`worktree-pill`) and external-session import metadata
> (`external-session-branch` / `-worktree`) render in the sessions UI, not the branch popover —
> see [`sessions.md`](./sessions.md) SP15/SP16.
