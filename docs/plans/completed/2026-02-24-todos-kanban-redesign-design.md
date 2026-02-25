# Todos Kanban Redesign

## Summary

Redesign the kanban card layout and column structure to better match the app's visual language and surface the features we actually have (task number, session, edit, delete).

## Goals

- Use the app background as column dividers (gap, not border lines)
- Streamline card information hierarchy
- Keep only data fields that exist (no progress bars, avatars, due dates)
- Surface task number, session, edit, delete more naturally

## Out of Scope

- Progress bars (no data)
- Due dates (no field)
- Assignee avatars (no UI for this)

---

## Column Layout

**Before:** columns share a `border-r border-mf-border` thin line separator.

**After:** the parent flex container uses `gap-px` (or `gap-0.5`) so the panel's background (`bg-mf-app-bg`) bleeds through as a natural divider. Each column has no border.

Column header format: `Open  4` — label text + count badge inline.

---

## Card Layout

```
┌─────────────────────────────────────────┐
│ [bug] #42 Fix auth token expiry         │
│ ● high                                  │
│ [backend] [auth]          [▶] [✏] [🗑] │
└─────────────────────────────────────────┘
```

### Row 1 — Type badge + number + title

- Type badge: colored pill (existing `TYPE_COLORS` map), left-aligned
- `#number`: mono font, `text-mf-text-secondary`, immediately after badge
- Title: `text-mf-text-primary`, truncate on overflow

### Row 2 — Priority pill

- Colored background pill, same palette as current `PRIORITY_COLORS` but as a badge not plain text
- `critical` → red, `high` → orange, `medium` → yellow, `low` → gray/secondary

### Row 3 — Labels + actions (hover)

- Labels: existing colored pills, left-aligned, `flex-wrap gap-1`
- Actions: right-aligned, appear on `group-hover`
  - `▶` Play icon — start session (only for `open` / `in_progress` todos)
  - `✏` Edit icon
  - `🗑` Delete icon (hover color → `text-mf-destructive`)
- "Session" text label is removed; icon only

---

## Files Changed

| File | Change |
|---|---|
| `packages/desktop/src/renderer/components/todos/TodoCard.tsx` | New card layout |
| `packages/desktop/src/renderer/components/todos/TodosPanel.tsx` | Column gap instead of border |

---

## Non-Goals

No logic changes. State management, API calls, drag-and-drop, and modal interactions are untouched.
