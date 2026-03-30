---
name: todos
description: Use when you need to understand project priorities, check what work is pending, summarize todos, pick the next task, or batch-implement multiple todos as PRs
---

# Todos

Read, analyse, and batch-implement the project's todo list.

## Databases

### `~/.mainframe/mainframe.db` (Projects DB)

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL,
  parent_project_id TEXT REFERENCES projects(id)
);
```

### `~/.mainframe/plugins/todos/data.db` (Todos DB)

```sql
CREATE TABLE todos (
  id TEXT PRIMARY KEY,              -- nanoid
  number INTEGER NOT NULL DEFAULT 0,
  project_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]',
  milestone TEXT,
  order_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Note:** `~/.mainframe/data.db` exists but has no tables.

## Two-Step Query

```bash
# 1. Resolve project ID
sqlite3 ~/.mainframe/mainframe.db "SELECT id FROM projects WHERE path = '$(pwd)';"

# 2. Query todos
sqlite3 -json ~/.mainframe/plugins/todos/data.db \
  "SELECT * FROM todos WHERE project_id = '<ID>' ORDER BY status, order_index, created_at;"
```

## Inserting Todos

Generate a 21-char alphanumeric ID, compute next `number`:

```bash
sqlite3 ~/.mainframe/plugins/todos/data.db \
  "SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = '<ID>';"
```

## Batch Implementation Workflow

When the user asks to find candidates and implement them (e.g. "find todos to fix", "batch implement", "prepare PRs"):

### Phase 1: Analyse and Present

1. Query all open/in_progress todos
2. Group by code area (labels, affected packages, theme)
3. Assess each: can it be done autonomously? (well-scoped, no user input needed, no design decisions)
4. Present a table with candidates, grouped by area, marking autonomy confidence
5. **Wait for user approval** before proceeding

### Phase 2: Group into PRs

After user selects todos, group them to minimize PR count:

- Related changes in the same package/area go together
- Bugs + features in the same area can share a PR
- Keep PRs reviewable (max ~5 todos per PR unless they're trivial)
- Name each PR group with a descriptive slug (e.g. `todos-plugin-enhancements`, `desktop-ux-fixes`)

Present the grouping plan. Proceed on approval (explicit or implicit).

### Phase 3: Create Worktrees and Dispatch

**REQUIRED SUB-SKILL:** Use `superpowers:using-git-worktrees` for all worktree creation. Create one worktree per PR group with descriptive names matching the PR slug (e.g. `todos-enhancements`, `desktop-ux`).

Do NOT use `isolation: "worktree"` on the Agent tool — it generates cryptic names like `agent-a2679050`.

Then dispatch agents to those worktree paths:

```
Agent(prompt: "Work in /path/to/.worktrees/todos-enhancements. Implement: ...")
```

Each agent prompt must include:
- The worktree path to work in
- Full context for each todo (number, title, body, labels)
- Relevant codebase context (file paths, architecture, patterns)
- Build/test commands to verify
- Instructions to commit on the existing branch and create a changeset

### Phase 4: Create PRs

After agents complete:
1. Verify each worktree builds cleanly
2. Push branches and create PRs with `gh pr create`
3. Handle submodules separately (push to their own remote, create PR there)
4. Report final PR list to user

### Phase 5: Cleanup

After user merges or explicitly asks:
```bash
git worktree remove .worktrees/<slug>
git branch -d <branch-name>  # only if merged
```

## Example Queries

```sql
-- Count by status
SELECT status, COUNT(*) FROM todos WHERE project_id = ? GROUP BY status;

-- Open bugs by priority
SELECT number, title, priority FROM todos
WHERE project_id = ? AND status = 'open' AND type = 'bug'
ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END;

-- Recent activity
SELECT number, title, status, updated_at FROM todos
WHERE project_id = ? ORDER BY updated_at DESC LIMIT 10;
```
