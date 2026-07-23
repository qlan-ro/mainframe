---
'@qlan-ro/mainframe-ui': patch
---

Sidebar now shows a session as Working while only background subagents are active.

The sidebar's WS event router dropped `background_task.started|updated|ended` in its default case, so a session whose only live activity was a background subagent never triggered a reload — the badge stayed on Idle even though the daemon's `displayStatus` was already Working. The router now reloads the session list on all three background-task lifecycle events.
