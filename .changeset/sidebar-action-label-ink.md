---
'@qlan-ro/mainframe-ui': patch
---

Mute the sidebar action labels so New Thread, Kanban and Automations sit at the same ink as the rows below them.

Their icons were already muted, but the labels rendered at full sidebar foreground, making the three rows read as the loudest thing in the sidebar. They now use `text-muted-foreground`, the resting ink the project rows already use.
