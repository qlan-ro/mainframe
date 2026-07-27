---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix live background work never showing in a session. The daemon never asked its
background-task tracker which tasks were running, so the pill above the composer
stayed empty and the session row showed no in-progress state while agents, bash
tasks, or workflows ran. This was reported against a workflow because a workflow
runs longest, but it affected every kind of background work.
