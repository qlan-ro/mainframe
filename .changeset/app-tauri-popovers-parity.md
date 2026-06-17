---
"@qlan-ro/mainframe-app-tauri": patch
---

Branch + tag popover artboard parity: branch quick-action rows use the compact
menu-row metrics with an always-accent New-branch plus; the submenu header/rows
tighten to 12px/label type; the conflict header gains a red hairline divider;
NewBranchDialog inputs become 30px mono fields with 0.5px hairlines. TagPopover
gets the "Tags" eyebrow, a leading search icon, left checkbox-square rows, and an
accent-plus "Create tag" menu row. (Deferred: the side-by-side submenu flyout —
the view-switch drill-in is kept; and the "check out after creating" checkbox —
needs an additive daemon checkout flag.)
