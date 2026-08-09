---
'@qlan-ro/mainframe-ui': patch
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-app-tauri': patch
---

Fix remote daemons paired over plain http: the paired scheme is now persisted and honored everywhere the endpoint is rebuilt, so an http remote connects instead of silently becoming unreachable. Plain http is refused at pairing time for any host other than loopback, with a clear explanation before a pairing code is spent.
