/**
 * Outline-view indentation, mirroring AppKit's `NSOutlineView.indentationPerLevel`:
 * each depth adds a fixed step on top of the parent's own base inset, rather than
 * measuring a specific parent row's icon/text column (which breaks whenever that
 * content's width changes or a third level is added).
 */
export const CONTEXT_SECTION_BASE_INSET_PX = 12;

/** Size of `ContextSection`'s disclosure chevron; also drives the child indent step. */
export const CONTEXT_DISCLOSURE_ICON_PX = 14;
/** Gap `ContextSection`'s header uses between chevron/icon/text; also drives the child indent step. */
export const CONTEXT_DISCLOSURE_GAP_PX = 6;

/**
 * A child row nests two "disclosure units" past the base inset — one for the chevron
 * + its gap, one for the header's own icon + its gap — landing the child's content
 * after the parent's icon (where the parent's own label text starts), not merely
 * under it.
 */
export const CONTEXT_INDENT_STEP_PX = (CONTEXT_DISCLOSURE_ICON_PX + CONTEXT_DISCLOSURE_GAP_PX) * 2;
