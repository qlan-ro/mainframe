---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix live background work never showing in a session. The daemon never asked its
background-task tracker which tasks were running, so the pill above the composer
stayed empty and the session row showed no in-progress state while agents, bash
tasks, or workflows ran. This was reported against a workflow because a workflow
runs longest, but it affected every kind of background work.

Also fix orphaned background tasks staying stuck "running" forever after the
CLI process exits (a stopped session, or a CLI crash) — the daemon now stops
every live task for that chat on exit, so the pill and in-progress state clear
along with it.
