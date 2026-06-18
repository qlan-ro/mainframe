---
"@qlan-ro/mainframe-app-tauri": patch
---

Consolidate every popover/menu onto one shared style source. A new
`components/ui/menu.tsx` (+ `menu-variants.ts`) owns `menuItemVariants` +
`MENU_CONTENT_PADDING` and the `Menu*` vocabulary (MenuRow/MenuLabel/
MenuSearchField/MenuCheckRow/MenuSelectRow/MenuDivider/MenuEmpty). The shadcn
dropdown/context-menu primitives now consume those variants (so all their
consumers update at once), and the hand-rolled Popover menus — branch, tag, sort,
launch, stop — migrate onto `Menu*`; the bespoke composer pickers adopt the shared
shell + label. Result: uniform 5px content padding, 9px-gap / 8×7 rows / 12px
labels / 13px icons / 6px radius across every menu, on both Radix substrates.
