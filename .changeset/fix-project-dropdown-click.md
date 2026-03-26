---
'@qlan-ro/mainframe-desktop': patch
---

fix(desktop): make entire project row clickable in projects dropdown

Clicking the right side of a project row (outside the text button) did nothing.
Added onClick to the row container so any click switches the project, unless
the delete confirmation is active.
