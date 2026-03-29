---
name: todo-reader
description: Use when you need to understand project priorities, check what work is pending, summarize todos, or pick the next task to work on
---

# Todo Reader

Read the project's todo list from SQLite to gather context or produce summaries.

## Database Paths

| DB | Path |
|----|------|
| Projects | `~/.mainframe/data.db` |
| Todos | `~/.mainframe/plugins/todos/data.db` |

## Two-Step Query

**1. Resolve project ID** from the current working directory:

```bash
sqlite3 ~/.mainframe/data.db "SELECT id FROM projects WHERE path = '$(pwd)';"
```

**2. Query todos** using that project ID:

```bash
sqlite3 -json ~/.mainframe/plugins/todos/data.db \
  "SELECT * FROM todos WHERE project_id = '<PROJECT_ID>' ORDER BY status, order_index, created_at;"
```

Use `-json` for structured output or `-column -header` for readable tables.

## Schema

| Column | Type | Values |
|--------|------|--------|
| id | TEXT | nanoid PK |
| number | INTEGER | auto-increment per project |
| project_id | TEXT | FK to projects.id |
| title | TEXT | required |
| body | TEXT | markdown |
| status | TEXT | open, in_progress, done |
| type | TEXT | bug, feature, enhancement, documentation, question, wont_fix, duplicate, invalid |
| priority | TEXT | low, medium, high, critical |
| labels | TEXT | JSON array of strings |
| assignees | TEXT | JSON array of strings |
| milestone | TEXT | nullable |
| order_index | REAL | drag-and-drop sort key |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

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
