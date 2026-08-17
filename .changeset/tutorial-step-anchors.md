---
'@qlan-ro/mainframe-ui': patch
---

Rebuild the first-run tour as a nine-step walk of the app — projects, sessions, the sessions list and tabs, the session rail, the workspace, ⌘K, Kanban, Automations and the daemon zone. It replaces a four-step tour that skipped from step 1 to step 4, because two of its steps pointed at a composer the empty workspace never mounts. The tour now waits for a first project before opening, so every step has something real to point at, and the counter is derived from the steps it can actually show. The first-run screen says the tour is coming, so the wait reads as promised rather than missing.
