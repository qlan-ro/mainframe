# Todo Reader Skill — Design Spec

## Problem

Agents working in this repo have no way to read the project's todo list. The todos live in a SQLite database managed by the builtin todos plugin. An agent that could query this data would gain context for prioritizing work and summarizing project state.

## Decision

A single SKILL.md file at `.claude/skills/todo-reader/SKILL.md`. No helper scripts.

## How It Works

The skill gives the agent two things: DB paths and the todos table schema. The agent uses `sqlite3` CLI to query directly.

### Two-step lookup

1. Resolve `project_id` from the current working directory:
   ```sql
   -- ~/.mainframe/data.db
   SELECT id FROM projects WHERE path = '<cwd>';
   ```
2. Query todos for that project:
   ```sql
   -- ~/.mainframe/plugins/todos/data.db
   SELECT * FROM todos WHERE project_id = '<project_id>';
   ```

### Schema reference

The skill includes the full column list with types and valid enum values:

| Column | Type | Values |
|--------|------|--------|
| id | TEXT | nanoid primary key |
| number | INTEGER | auto-incremented per project |
| project_id | TEXT | FK to projects.id |
| title | TEXT | required |
| body | TEXT | markdown content |
| status | TEXT | open, in_progress, done |
| type | TEXT | bug, feature, enhancement, documentation, question, wont_fix, duplicate, invalid |
| priority | TEXT | low, medium, high, critical |
| labels | TEXT | JSON array of strings |
| assignees | TEXT | JSON array of strings |
| milestone | TEXT | nullable |
| order_index | REAL | drag-and-drop ordering |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

### Output

Raw rows. The agent decides how to classify, group, or summarize based on context. No prescribed format.

### Scope

Current project only. The `project_id` filter ensures the agent sees only todos belonging to the working directory's project.

## What the skill is NOT

- Not a CLI tool or script — just documentation for the agent.
- Not cross-project — scoped to current project.
- Not prescriptive about output format — the agent adapts to the question.

## Location

`.claude/skills/todo-reader/SKILL.md` in the mainframe repo (project-scoped).
