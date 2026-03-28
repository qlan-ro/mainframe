# Mid-Session Worktree

Enable worktree creation on a chat that already has a running CLI session.

## Problem

Currently, `enableWorktree` and `attachWorktree` in `ChatConfigManager` reject calls when `chat.claudeSessionId` is set. Users must decide before the first message whether to use a worktree. This is limiting because the need for isolation often becomes apparent mid-conversation.

## Design

### Flow

1. **Create the git worktree** (reuse existing `createWorktree()`)
2. **Kill the running CLI process**
3. **Move session files** from `~/.claude/projects/<encoded-original-path>/` to `~/.claude/projects/<encoded-worktree-path>/`:
   - `<sessionId>.jsonl` (main conversation)
   - `<sessionId>/` directory (subagents + tool-results)
   - Sibling sidechain `.jsonl` files that reference this sessionId
4. **Update chat metadata** (`worktreePath`, `branchName`) in DB
5. **Respawn with `--resume`** in worktree path as `cwd`

After this, the session is indistinguishable from one that started in a worktree. All existing features (file tree, resume on restart, worktree cleanup) work without changes.

### Session File Migration

Claude CLI stores session data at `~/.claude/projects/<encoded-path>/` where the path is encoded as `projectPath.replace(/[^a-zA-Z0-9-]/g, '-')`.

Files to move for a given `sessionId`:

| Source | Description |
|--------|-------------|
| `<sessionId>.jsonl` | Main conversation history |
| `<sessionId>/subagents/*.jsonl` | Subagent conversation logs |
| `<sessionId>/subagents/*.meta.json` | Subagent metadata |
| `<sessionId>/tool-results/*.txt` | Cached tool outputs |
| Sibling `*.jsonl` matching `sessionId` | Sidechain files |

The migration function:
1. Compute source and target project dirs from the encoded paths
2. `mkdir -p` the target project dir
3. Move `<sessionId>.jsonl` to target
4. Move `<sessionId>/` directory to target (if it exists)
5. Scan sibling `.jsonl` files in source dir; move those whose first line has `sessionId` matching ours

### Code Changes

#### `packages/core/src/chat/config-manager.ts`

Lift the `claudeSessionId` guard on `enableWorktree`. When a session exists:

```
async enableWorktree(chatId, baseBranch, branchName):
  // ... existing validation ...
  // Remove: if (active.chat.claudeSessionId) throw ...

  if (active.chat.claudeSessionId) {
    // Mid-session path
    kill session
    move session files (original project path -> worktree path)
    create worktree
    update DB
    respawn
  } else {
    // Pre-session path (existing logic)
    create worktree
    update DB
  }
```

Order matters: create the worktree first so the directory exists for the respawned process, but compute the encoded paths before creating it.

#### `packages/core/src/workspace/worktree.ts` (or new file)

Add `moveSessionFiles(sessionId, fromProjectPath, toProjectPath)`:
- Computes encoded source/target dirs
- Moves the three categories of files
- Uses `fs/promises` (`rename` for same-filesystem moves, `cp` + `unlink` fallback for cross-device)

#### `ChatConfigManager` deps

Add `stopChat` and `startChat` to the deps interface so the config manager can kill and respawn.

### What Doesn't Change

- `ChatLifecycleManager.doStartChat()` already resolves `effectivePath = chat.worktreePath ?? project.path` — works as-is
- `loadHistory()` uses the same encoded path logic — finds the moved files
- File tree, worktree cleanup, resume on restart — all use `effectivePath`
- `disableWorktree` keeps its session guard (moving files back mid-session is out of scope)
- Desktop UI `WorktreePopover` already has the enable flow, just currently disabled when session is active

### Edge Cases

- **No active session but `claudeSessionId` set** (e.g., app restarted, process not running): still need to move files before updating metadata, but skip kill/respawn since there's no process.
- **Move fails mid-way**: if the JSONL moves but the directory doesn't, the session is partially migrated. Best effort: attempt all moves, throw if the primary JSONL move fails.
- **Cross-device moves**: worktree dir and `~/.claude` could be on different filesystems. Use `rename` first, fall back to copy+delete.

### UI Changes

The `WorktreePopover` currently disables the "Enable worktree" button when a session is active. Remove that guard — the backend now handles it.

## Out of Scope

- Mid-session `disableWorktree` (moving files back from worktree path to original)
- Mid-session `attachWorktree` (attaching an existing worktree mid-session — same pattern, can be added later)
