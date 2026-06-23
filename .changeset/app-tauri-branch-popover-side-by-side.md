---
"@qlan-ro/mainframe-app-tauri": patch
---

Rework the branch popover from a drill-in to a side-by-side layout matching the
`13-popover` artboard: selecting a branch keeps the list visible and opens its
submenu in an adjacent card (the popover grows to fit, with a gap between the two
cards), the selected row is highlighted, clicking the selected branch again
toggles the submenu closed, and the submenu's back button collapses it. new-branch
/ rename / conflict remain full-replace overlays.
