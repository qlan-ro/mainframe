---
'@qlan-ro/mainframe-ui': patch
---

Retire the v1 layer from packages/ui: the duplicated tooltip, hint, popover, dropdown-menu and scroll-area primitives now render through their v2 counterparts, the remaining app-owned primitives sit on v2 tokens, and every generic `mf-*` colour is swept off the legacy islands and deleted from the bridge sheet.
