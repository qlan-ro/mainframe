# Session Row Tagging — Design

**Status:** Draft
**Date:** 2026-05-05
**Issue:** #64

## Problem

Sessions accumulate quickly. Renaming each one to encode state (`bug:`, `wip-`, etc.) is a manual workaround for a missing primitive: lightweight categorization. Identity (worktree, PR) and category (tags) are also currently mixed in the same metadata line, which makes both harder to scan.

This feature adds user-defined tags on session rows, plus a small set of system-managed synthetic chips (`has-pr`, `has-worktree`) for stateful filtering. Identity (worktree, PR) stays in the title row as before.

## Goals

- User can apply, create, rename, recolor, and delete tags on sessions.
- Filter the sessions list by project + tags (strict AND).
- Identity badges (worktree pill, PR badge) move to the title row to keep the tag namespace clean.
- Storage and queries scale to thousands of sessions and tags without rewrites.

## Non-Goals

- Linking sessions to todos (separate feature; `has-todo` deferred).
- `Cmd+K` `tag:` query token (deferred).
- Multi-device tag sync (project-wide concern, not solved here).
- Tag analytics (usage counts in delete/merge dialogs).
- Filter state persistence across launches (resets every launch).

## Layout

### Session row

```
● [pin] Title text                [feat-tool-cards 🌿] [PR ↗]   1d
        [feature]  [bug]  [ui]
```

- **Title row (identity):** status dot, optional pin, title, then on the right — worktree pill (mono, max-width 140px, tooltip = full path), PR badge (clickable, opens PR), relative time.
- **Tag row (categorization):** filled colored pills, label only (no leading dot). Renders only when the chat has user tags or the row is hovered. On hover, an empty row shows a faint `+ tag` ghost as a click target.
- **Hover actions:** the time slot is replaced by `Tag / Rename / Archive` icon buttons. No reflow (slot width reserved).
- The previous `📁 project · 🌿 worktree · ⏰ time` metadata line is removed.

### Filter bar (sessions panel header)

```
PROJECT:  [All]  [mainframe]  [DBricks_Optimizer]  [Anastasia] ...
TAGS:     [• feature] [• bug] [• ui] [• refactor] [• has-pr] [• has-worktree]
```

- **Project row:** existing pills, single-select. `All` is default.
- **Tags row:** outlined pills with leading colored dot. User tags and synthetic chips flow together (no divider). Synthetic chips use a neutral gray dot.
- **Filter logic:** strict AND across every selected chip in every row. Project AND tag1 AND tag2 AND has-pr AND has-worktree.
- **Empty state:** if there are no user tags and no synthetic matches, the `TAGS:` row hides.
- **Persistence:** filter state resets on every launch.

### Tag editor popover

Triggered by:
- Right-click on a session row → context menu has `Tags...`.
- Click on the tag row of a session, or the `+ tag` ghost on empty hover.

```
TAG SESSION
[# Find or create...        ]
─────────────────────────────
✓ • feature
✓ • ui
  • bug
  • refactor
─────────────────────────────
+ Create tag "mobile"     ← when query has no exact match
```

- Toggling a row applies/removes the tag immediately (optimistic).
- `+ Create tag "<query>"` appears when the query is non-empty and no exact match exists. Validates `[a-z0-9-]+`, max 24 chars, rejects `has-*` prefix with inline error.
- Synthetic chips do NOT appear here — they are system-managed.
- Right-click a tag inside the popover → `Rename` / `Change color` / `Delete from all sessions`. Right-clicking a chip in the filter bar opens the same menu.

## Tag Format & Colors

- **Name format:** lowercase, `^[a-z0-9-]+$`, max 24 characters.
- **Reserved prefix:** `has-` is system-only. Creating any tag starting with `has-` returns an inline error.
- **Color:** assigned automatically on create from the seed palette via stable hash on the name. User can recolor via the right-click menu. Colors are stored in the `tags` registry, not on associations.

```ts
// packages/types/src/tags.ts
export const TAG_PALETTE = [
  'blue', 'red', 'purple', 'violet', 'amber',
  'teal', 'cyan', 'green', 'pink', 'orange',
] as const;
export type TagColor = typeof TAG_PALETTE[number];
export const RESERVED_TAG_PREFIX = 'has-';
```

Concrete hex values map from existing `mf-*` Tailwind tokens; if missing, add `mf-tag-{color}` tokens to the design system.

## Data Model

New tables in `packages/core/src/db/schema.ts`:

```sql
CREATE TABLE tags (
  name       TEXT PRIMARY KEY,        -- normalized lowercase
  color      TEXT NOT NULL,           -- TagColor key
  created_at TEXT NOT NULL
);

CREATE TABLE chat_tags (
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE,
  source     TEXT NOT NULL DEFAULT 'user', -- 'user' (only value in v1)
  created_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, tag, source)
);
CREATE INDEX idx_chat_tags_chat ON chat_tags(chat_id);
CREATE INDEX idx_chat_tags_tag  ON chat_tags(tag);
```

### Synthetic tags

Synthetic tags (`has-pr`, `has-worktree`) are NOT stored. They are computed at query time from existing chat row fields:

- `has-pr` ← chat has a created PR URL or detected PR.
- `has-worktree` ← `chats.worktree_path IS NOT NULL`.

This avoids stale-data problems and event plumbing. Filter queries use `WHERE` clauses on the chat row directly.

### Cascade

`ON DELETE CASCADE` on `chat_tags.chat_id` removes associations on chat deletion (per Code Rules — cascade deletes for parent entities).

`ON UPDATE CASCADE` on `chat_tags.tag` lets rename be a single `UPDATE tags SET name = ?` statement.

### Migrations

Additive. No data migration needed. Initial registry is empty; tags appear as users create them.

## API

All routes are HTTP, Zod-validated. No WebSocket events — tag mutations are user-triggered from a single client.

### Tag registry

- `GET    /tags` → `{ tags: Array<{ name: string, color: TagColor }> }`
- `POST   /tags` → body `{ name: string, color?: TagColor }` → 201 with created tag. 400 on invalid format or reserved prefix.
- `PATCH  /tags/:name` → body `{ rename?: string, color?: TagColor }` → 200. Rename atomically updates `tags.name` and cascades to `chat_tags`. If the new name already exists, performs a merge (associations deduped via `INSERT OR IGNORE`).
- `DELETE /tags/:name` → 204. Removes tag and all associations via cascade.

### Chat associations

- `GET /chats/:id/tags` → `string[]` (user tags only).
- `PUT /chats/:id/tags` → body `{ tags: string[] }` → replaces user-source associations atomically. Auto-creates any tag that doesn't exist yet (palette-hashed color).

### Chat list filtering

Extend the existing list endpoint:

- `GET /chats?project=<id>&tags=feature,bug&synthetic=has-pr,has-worktree`
- AND across all parameters.
- Synthetic resolved server-side from `chats.worktree_path` and PR fields.

## Frontend

### Files touched

- `packages/desktop/src/renderer/components/panels/FlatSessionRow.tsx`
  - Drop the metadata line; render worktree pill + PR badge + time on the right of the title row.
  - Add tag row below the title row, conditional on `chat.tags.length > 0 || hovered`.
  - Add `Tag` icon to the hover action group (alongside Rename / Archive).

- `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx`
  - Add filter bar component above the list. Wire filter state to chat list query.

### New files

- `packages/desktop/src/renderer/components/tags/TagPopover.tsx` — search, list, toggle, create. Triggered by right-click and tag-row-click.
- `packages/desktop/src/renderer/components/tags/TagPill.tsx` — two variants: `row` (filled, no dot) and `filter` (outlined, leading dot).
- `packages/desktop/src/renderer/components/tags/FilterBar.tsx` — project pills + tag chips.
- `packages/desktop/src/renderer/store/tags.ts` — Zustand store: registry cache, filter state (project + selected tags), session→tags map. Optimistic updates with rollback on API failure.
- `packages/types/src/tags.ts` — `Tag`, `TagColor`, `TAG_PALETTE`, `RESERVED_TAG_PREFIX`.
- `packages/core/src/lib/validateTagName.ts` — single source of truth for name validation.

### Extensions

- `packages/types/src/chat.ts` — add `Chat.tags?: string[]` (user tags), populated by daemon on list/get.
- `packages/desktop/src/renderer/lib/api.ts` — add `listTags / createTag / updateTag / deleteTag / getChatTags / setChatTags`.

### Color resolution

`getTagColor(name, registry)` returns the registry color, or hashes the name to a palette entry as a fallback (handles eventual-consistency before registry loads).

## Edge Cases

- **Empty list with active filters** → empty-state message with a `Clear filters` button.
- **Tag with zero matches in current filter** → chip stays in the bar; deselecting unstucks. It does NOT disappear mid-interaction.
- **Filter bar tag list scope** → tags currently used by any chat in the active project (or all projects if `All`). Unused tags are hidden from the bar but still appear in the popover.
- **Renaming to an existing name** → confirmation modal: "Merge `feat` into `feature`?" — no usage count query.
- **Deleting a tag** → confirmation modal: "Delete tag `feature`? This removes it from all sessions." — no usage count.
- **Synthetic chip with zero matches** → still rendered (consistent set). Selecting shows the empty state. Avoids flicker on PR open/close.
- **Archived sessions** → excluded from the filter bar's tag-aggregation query. Tags stay attached on the row.
- **Concurrent tag creation** → server uses `INSERT OR IGNORE`; whichever insert wins owns the color.

## Testing

Per Code Rules: new public methods need tests; coverage thresholds enforced.

### Core DB (`packages/core/src/db/__tests__/`)

- `tags.test.ts` — CRUD, normalization, reserved prefix rejection, format validation, rename cascade, merge-on-rename, color preserved on update.
- `chats.test.ts` (extend) — `getChatTags`, `setChatTags`, cascade delete on chat removal, idempotency of `setChatTags`.

### Core routes (`packages/core/src/server/__tests__/`)

- `tags.routes.test.ts` — Zod validation on each endpoint, 400s for malformed input, 404s for unknown tags.
- `chats.routes.test.ts` (extend) — list filtering with `project + tags + synthetic` (AND), synthetic computed correctly from chat row fields.

### Validation helper

- `validateTagName.test.ts` — table-driven cases including the reserved `has-*` prefix.

### Renderer

- `TagPopover` — open/close, create flow, toggle apply, validation error display.
- `tags` store — subscription correctness, optimistic update and rollback on API failure.

No E2E in v1 — covered by component + store tests.

## Open Items

None at design time. Implementation plan to follow.
