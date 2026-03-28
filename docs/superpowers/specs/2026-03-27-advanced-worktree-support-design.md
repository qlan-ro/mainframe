# Advanced Worktree Support

Kanban: #34 | Priority: Medium

## Summary

Extend the existing worktree system with three capabilities:

1. **Base branch selector** -- choose which branch to fork from (currently always HEAD).
2. **Custom branch name** -- user-provided name instead of `session/<shortId>`.
3. **Fork to worktree** -- mid-session action that creates a new chat with worktree isolation.

The existing one-click toggle becomes a popover that adapts to session state.

## Current State

- Toggle in composer toolbar (pre-session only, gated by `claudeSessionId`).
- `createWorktree(projectPath, chatId, dirName)` always forks from HEAD with branch `session/<first8ofChatId>`.
- Cleanup on archive via `removeWorktree`.
- `getEffectivePath` already routes file browsing, search, git reads, and context to the worktree path.
- Enable/disable sent as WS events (`chat.enableWorktree`, `chat.disableWorktree`).

## Design

### Backend

#### `createWorktree` Signature Change

```
createWorktree(projectPath, chatId, dirName, baseBranch, branchName)
```

All parameters required. `baseBranch` is the start-point for `git worktree add`. `branchName` is the `-b` argument. The caller provides both explicitly; no default-generation logic in this function.

#### `enableWorktree` Signature Change

```
enableWorktree(chatId, baseBranch, branchName)
```

Passes through to `createWorktree`. The `claudeSessionId` guard remains.

#### `disableWorktree`

Unchanged. No new parameters needed.

#### New: `forkToWorktree`

New method on `LifecycleManager` (orchestrates chat creation + worktree setup):

```
forkToWorktree(chatId, baseBranch, branchName) -> { chatId: string }
```

1. Look up the source chat's project.
2. Check git status -- if uncommitted changes exist, return 409 error.
3. Create a new chat for the project via `createChat`.
4. Call `enableWorktree(newChatId, baseBranch, branchName)`.
5. Return `{ chatId: newChatId }`.

The original session stays open and untouched.

#### Branch Name Validation

Zod schema: `z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/).refine(s => !s.includes('..'))`.

Rejects: leading dots/dashes, `..` sequences, spaces, `~`, `^`, `:`, and other git-forbidden characters. Applied on both `enableWorktree` and `forkToWorktree` endpoints.

#### HTTP Endpoints (Replace WS Events)

| Endpoint | Method | Body | Response |
|----------|--------|------|----------|
| `/api/chats/:id/enable-worktree` | POST | `{ baseBranch, branchName }` | 200 (chat.updated emitted) |
| `/api/chats/:id/disable-worktree` | POST | (none) | 200 (chat.updated emitted) |
| `/api/chats/:id/fork-worktree` | POST | `{ baseBranch, branchName }` | 200 `{ chatId }` |

WS events `chat.enableWorktree` and `chat.disableWorktree` are removed from `ClientEvent`, `ws-schemas.ts`, `websocket.ts`, and `client.ts`.

### UI: Unified Worktree Popover

A single `WorktreePopover` component replaces the current toggle button. The trigger remains the `GitBranch` icon in the composer toolbar. Clicking opens a popover whose content adapts based on session state:

#### State 1: Pre-session Config (`!hasMessages && !worktreePath`)

- **Base branch**: dropdown of local branches from `GET /api/projects/:id/git/branches`. Pre-selects the current branch.
- **Branch name**: text input, pre-filled with `session/<first8ofChatId>`. Validated inline with the same regex as the server.
- **Buttons**: Enable / Cancel.

#### State 2: Mid-session Fork (`hasMessages && !worktreePath`)

- **Warning banner**: "This will create a new chat with worktree isolation. Uncommitted changes and conversation context from this session will not be carried over."
- **Base branch**: dropdown, pre-selects current branch.
- **Branch name**: text input, empty by default for the user to name.
- **Buttons**: Fork / Cancel.
- On success, client navigates to the new chat (existing `chat.created` WS event handles sidebar update).

#### State 3: Active Info (`worktreePath` is set)

- Read-only display: green "Isolated" indicator, branch name (monospace), worktree path.
- No actions -- worktree cannot be changed after session start.

#### Branch Data Fetching

Branches are fetched when the popover opens (not eagerly). Loading spinner while fetching.

### Client API Changes

`daemonClient` methods switch from WS to HTTP:

- `enableWorktree(chatId, baseBranch, branchName)` -- POST
- `disableWorktree(chatId)` -- POST
- `forkToWorktree(chatId, baseBranch, branchName)` -- POST, returns `{ chatId }`

### Fork Dirty-State Handling

When the user triggers "Fork to worktree", the server checks `GitService.status()` on the project. If there are uncommitted changes, it returns 409. The client shows a tooltip or toast: "Commit or stash your changes before forking."

Uncommitted changes stay in the original directory. The worktree is a fresh checkout from the base branch tip.

### Worktree Awareness Indicators

Several UI areas lack visual cues that the user is working in a worktree session. These changes make the worktree state visible throughout the interface.

| Location | File | Change |
|----------|------|--------|
| **File tree header** | `FilesTab.tsx` | Show `worktreePath` instead of `activeProject.path` when active chat has a worktree. The file listing is already worktree-aware (passes `chatId`), only the displayed path is wrong. |
| **Changes tab** | `ChangesTab.tsx` | Add a small badge or label like "Worktree: `feat/auth-worktree`" when active chat has a worktree. |
| **Branch popover** | `BranchPopover.tsx` | Add a banner at top: "Working in worktree isolation" with the worktree path when active. |
| **Title bar** | `TitleBar.tsx` | Append the worktree branch name: e.g. `Mainframe — ProjectName / feat/auth-worktree`. |

### Launch Configurations — Worktree-Aware

Launch routes (`/api/projects/:id/launch/...`) currently use `project.path` directly, so launch processes always run in the project root even when a worktree session is active. This means dev servers serve the wrong branch's code.

**Fix:** Launch start/stop/status/configs endpoints accept an optional `chatId` query parameter. When provided, the route resolves the effective path via `getEffectivePath` (returns `worktreePath` if the chat has one). This path is passed to `LaunchRegistry.getOrCreate`.

**LaunchRegistry change:** Currently keyed by `projectId` alone. Change to key by `projectId:path` so that a worktree session gets its own `LaunchManager` instance with the worktree path as `cwd`. The project root and each worktree can run independent launch processes.

**Client change:** `startLaunchConfig`, `stopLaunchConfig`, and `fetchLaunchStatuses` gain an optional `chatId` parameter, appended as `?chatId=X`. The title bar's launch button and `useLaunchConfig` hook pass the active `chatId`.

**`launch.json` resolution:** Read from the effective path (worktree), not always project root. Git worktrees inherit the file from the repo, so it's available in both locations.

### Existing Behavior Preserved

- `getEffectivePath` continues to route file browsing, search, git reads, and context to the worktree.
- CLI adapter spawns with worktree path as `cwd`.
- Worktree cleanup on archive (`removeWorktree`) is unchanged.
- `claudeSessionId` guard on `enableWorktree`/`disableWorktree` is unchanged.
- TODOs (kanban plugin) are project-scoped via `project_id` in their own DB -- unaffected by worktrees.

## Error Cases

| Scenario | Status | Client Behavior |
|----------|--------|-----------------|
| Invalid branch name | 400 | Inline validation error in popover |
| Base branch doesn't exist | 400 | Toast |
| Git worktree creation fails | 500 | Toast |
| Fork with dirty working tree | 409 | Tooltip: "Commit or stash changes first" |
| Enable after session started | 400 | Same `claudeSessionId` guard |

## Testing

- Unit tests for `createWorktree` with explicit `baseBranch` + `branchName`.
- Unit tests for branch name validation (valid names, git-forbidden chars, leading dots, `..`).
- Unit tests for `forkToWorktree` -- creates new chat, enables worktree, returns new ID.
- Unit test for dirty state check -- fork refused when uncommitted changes exist.
- Route tests for the three new HTTP endpoints.

## Out of Scope

- Mid-session worktree enable/disable (blocked by CLI cwd binding).
- Remote branch selection (user can fetch/checkout via git panel first).
- Stash or auto-commit on fork (user manages working tree state).
