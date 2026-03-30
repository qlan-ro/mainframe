# Inline Todo Filter Bar

## Problem

The current `TodoFilterBar` stacks search, type chips, priority chips, and label chips vertically across 4 rows. This wastes vertical space in a panel where the Kanban columns need as much height as possible.

## Design

Rewrite `TodoFilterBar` as a single horizontal row with all controls inline.

### Layout (left to right)

```
Type: [bug] [feature] [enhancement] [docs] [question] | Priority: [critical] [high] [medium] [low] | [Labels (n) ▾] | [Clear] [ 🔍 Filter by title... ]
```

1. **"Type:" label + chips** — inline multi-select toggle chips. Existing styling (`chipBase`/`chipOn`/`chipOff`).
2. **Vertical divider** — thin `border-l border-mf-border` separator.
3. **"Priority:" label + chips** — same chip pattern.
4. **Vertical divider.**
5. **Labels button** — text "Labels" with chevron-down icon. Shows `(n)` count badge when labels are selected. Opens a popover on click.
6. **Vertical divider** (only when clear is visible).
7. **Clear filters** — text button, only rendered when any filter is active.
8. **Search input** — right-aligned, fixed ~160px width. Magnifying glass icon + X to clear. Same styling as current.

### Labels Popover

- Anchored below the Labels button, left-aligned.
- Contains a vertical list of checkboxes, one per label from `allLabels`.
- Multi-select — toggling a checkbox updates `filters.labels` via `onChange`.
- Closes on: outside click, Escape key.
- Max height with scroll if many labels.

### Overflow

If the row overflows (small panels), `overflow-x-auto` with no wrapping. The row scrolls horizontally.

## Scope

- **Only file changed:** `TodoFilterBar.tsx`
- **No changes to:** `TodosPanel.tsx`, `TodoCard.tsx`, filter logic functions (`matchesFilters`, `extractAllLabels`, `toggleItem`), or the `TodoFilters` interface.
- The `LabelsPopover` is a local sub-component within `TodoFilterBar.tsx` (not exported).

## Keyboard / Accessibility

- Labels popover closes on Escape.
- Chips remain `<button>` elements with existing keyboard support.
- Search input retains existing focus behavior.
