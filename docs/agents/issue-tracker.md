# Issue tracker: Mainframe Todos Plugin

Issues (todos) for this repo live in the Mainframe app's own todos plugin — a per-project SQLite table, not GitHub Issues. Use `sqlite3` directly.

## Databases

- `~/.mainframe/mainframe.db` — resolve this repo's `project_id`: `SELECT id FROM projects WHERE path = '<repo-path>';`
- `~/.mainframe/plugins/todos/data.db` — the `todos` table, scoped by `project_id`.

## Schema

`id` (nanoid), `number` (per-project sequence), `project_id`, `title`, `body`, `status` (default `open`), `type` (default `feature`), `priority` (default `medium`), `labels` (JSON array), `assignees` (JSON array), `milestone`, `order_index`, `created_at`, `updated_at`.

## Conventions

- **Create a todo**: resolve `project_id`, compute next `number` (`SELECT COALESCE(MAX(number),0)+1 FROM todos WHERE project_id = ?`), generate a 21-char nanoid `id`, `INSERT` into `~/.mainframe/plugins/todos/data.db`.
- **Read a todo**: `sqlite3 -json ~/.mainframe/plugins/todos/data.db "SELECT * FROM todos WHERE project_id = '<id>' AND number = <n>;"`
- **List todos**: `SELECT * FROM todos WHERE project_id = '<id>' ORDER BY status, order_index, created_at;`, filtering on `status`/`type`/`priority`/`labels`.
- **Apply / remove labels**: `labels` is a JSON array column — read, mutate, write back the full array. There's no single-label add/remove.
- **Close**: `UPDATE todos SET status = 'closed', updated_at = <now> WHERE id = '<id>';`
- **Comments**: no comment table exists — append updates to `body` under a `## Comments` heading.

## When a skill says "publish to the issue tracker"

Insert a row into the `todos` table for this project, per **Create a todo** above.

## When a skill says "fetch the relevant ticket"

Query `todos` by `number` (or `id`) scoped to this project's `project_id`, per **Read a todo** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one todo row with **child** todo rows as tickets.

- **Map**: a todo with a `wayfinder:map` entry in `labels`, holding the Notes / Decisions-so-far / Fog body in `body`.
- **Child ticket**: a todo with a `wayfinder:<type>` label (`research`/`prototype`/`grilling`/`task`) and a `Part of #<map-number>` line at the top of `body`.
- **Blocking**: a `Blocked by: <n>, <n>` line near the top of `body` (schema has no dependency edges). Unblocked when every listed todo has `status = 'closed'`.
- **Frontier query**: open, unassigned todos for the map (`status = 'open'`, empty `assignees`), dropping any with an open blocker; first by `order_index`/`number` wins.
- **Claim**: set `assignees` to `["@me"]` — the session's first write.
- **Resolve**: append the answer to `body` under `## Answer`, set `status = 'closed'`, append a context pointer (gist + link) to the map todo's Decisions-so-far.
