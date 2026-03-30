---
name: todos
description: Use when you need to understand project priorities, check what work is pending, summarize todos, or pick the next task to work on
---

# Todo Reader

Read the project's todo list from SQLite to gather context or produce summaries.

Do NOT explore, list tables, or list databases. All paths, table names, and schemas are documented below.

## Databases

### `~/.mainframe/mainframe.db` (Projects DB)

Only the `projects` table is relevant to this skill.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,        -- absolute filesystem path
  created_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL,
  parent_project_id TEXT REFERENCES projects(id)
);
CREATE INDEX idx_projects_path ON projects(path);
```

### `~/.mainframe/plugins/todos/data.db` (Todos DB)

Only the `todos` table exists in this database.

```sql
CREATE TABLE todos (
  id TEXT PRIMARY KEY,              -- nanoid
  number INTEGER NOT NULL DEFAULT 0,-- auto-increment per project
  project_id TEXT NOT NULL DEFAULT '',-- FK to projects.id
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',     -- markdown
  status TEXT NOT NULL DEFAULT 'open',   -- open | in_progress | done
  type TEXT NOT NULL DEFAULT 'feature',  -- bug | feature | enhancement | documentation | question | wont_fix | duplicate | invalid
  priority TEXT NOT NULL DEFAULT 'medium',-- low | medium | high | critical
  labels TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  assignees TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  milestone TEXT,                        -- nullable
  order_index REAL NOT NULL DEFAULT 0,   -- drag-and-drop sort key
  created_at TEXT NOT NULL,              -- ISO 8601
  updated_at TEXT NOT NULL               -- ISO 8601
);
```

**Note:** `~/.mainframe/data.db` exists but has no tables — do not use it.

## Two-Step Query

**1. Resolve project ID** from the current working directory:

```bash
sqlite3 ~/.mainframe/mainframe.db "SELECT id FROM projects WHERE path = '$(pwd)';"
```

**2. Query todos** using that project ID:

```bash
sqlite3 -json ~/.mainframe/plugins/todos/data.db \
  "SELECT * FROM todos WHERE project_id = '<PROJECT_ID>' ORDER BY status, order_index, created_at;"
```

Use `-json` for structured output or `-column -header` for readable tables.

## Inserting Todos

Generate a random 21-char alphanumeric ID and compute the next `number`:

```bash
sqlite3 ~/.mainframe/plugins/todos/data.db \
  "SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = '<PROJECT_ID>';"
```

Then insert with all required columns. Timestamps use ISO 8601 UTC.

## Example Queries

Count by status:
```sql
SELECT status, COUNT(*) as count FROM todos WHERE project_id = ? GROUP BY status;
```

Open bugs by priority:
```sql
SELECT number, title, priority FROM todos
WHERE project_id = ? AND status = 'open' AND type = 'bug'
ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END;
```

Recent activity:
```sql
SELECT number, title, status, updated_at FROM todos
WHERE project_id = ? ORDER BY updated_at DESC LIMIT 10;
```
