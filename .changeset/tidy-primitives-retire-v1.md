---
'@qlan-ro/mainframe-ui': patch
---

Retire the v1 layer from packages/ui. The duplicated tooltip, hint, popover, dropdown-menu and scroll-area primitives now render through their v2 counterparts; every generic `mf-*` colour and the whole v1 type scale are swept onto v2 semantics and deleted from the bridge sheet, which now holds only domain palettes and app chrome with no v2 equivalent.
