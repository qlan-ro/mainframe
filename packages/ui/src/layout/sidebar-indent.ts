/**
 * Left-sidebar indentation — one fixed step per nesting depth, mirroring
 * AppKit's `NSOutlineView.indentationPerLevel` (same idea as the sibling
 * system in `features/context-panel/layout-constants.ts`). Projects /
 * Sessions / Tasks / Tags and their rows all consume this ONE scale, so no
 * section hardcodes its own inset and switching sections still reads as the
 * same outline.
 *
 * Level 0 — a section title (flush, e.g. "Sessions").
 * Level 1 — a direct child of a section (rows, "+ New X" buttons, group
 *   labels like "Pinned"/"Today").
 * Level 2 — content nested under a level-1 group (session rows under their
 *   time-group label — currently the only level-2 case; task rows stay at
 *   level 1 since there is no task sub-grouping yet).
 *
 * `sidebarIndentPx(level)` is the total left inset for a FLUSH row (a plain
 * header/label element with no separate button chrome) — apply it directly
 * as that element's own `paddingLeft`.
 *
 * Rows built from a full-width button/pill that already carries its own
 * `px-[12px]` internal icon/text padding (exactly `SIDEBAR_BASE_INSET_PX`)
 * apply only `level * SIDEBAR_INDENT_STEP_PX` as their wrapper's/margin's
 * LEFT offset — the button's built-in padding already supplies the base, so
 * it cancels out of `sidebarIndentPx(level) - SIDEBAR_BASE_INSET_PX`,
 * landing the pill's visible content at the same total position a flush row
 * would use at that level. The right edge is never level-dependent — leave
 * whatever flat right padding/margin a row already has untouched.
 */
export const SIDEBAR_BASE_INSET_PX = 12;
export const SIDEBAR_INDENT_STEP_PX = 12;

/**
 * Gutter (mx-2, this repo's compressed spacing scale = 4px) on rows whose
 * OWN element carries a hover/active highlight background — the highlight
 * must stay full-width (macOS keeps a selected row's highlight full-width
 * even when its content is indented under a nested group), so it can't also
 * carry the level's margin. Content indentation on these rows is instead
 * `sidebarIndentPx(level) - SIDEBAR_ROW_GUTTER_PX` of paddingLeft, so the
 * highlight's own gutter doesn't get double-counted on top of the content
 * inset — landing the content at the same total position a flush row (one
 * with no separate highlight, like a group label) would use at that level.
 */
export const SIDEBAR_ROW_GUTTER_PX = 4;

export type SidebarIndentLevel = 0 | 1 | 2;

export function sidebarIndentPx(level: SidebarIndentLevel): number {
  return SIDEBAR_BASE_INSET_PX + level * SIDEBAR_INDENT_STEP_PX;
}
