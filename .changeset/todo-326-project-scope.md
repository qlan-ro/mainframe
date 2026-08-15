---
'@qlan-ro/mainframe-ui': patch
---

The Kanban board and the Automations library each get their own in-modal project picker, seeded from the sidebar's project filter on every open. Both surfaces now always open — with no session active or a projectless draft, they offer a project picker instead of a dead click — and an in-modal change is local to that open: it never writes back to the sidebar filter and is forgotten on close.
