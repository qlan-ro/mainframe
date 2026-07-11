---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Stop leaking the daemon on quit and fail loudly on port collisions. macOS quit paths (Cmd+Q, updater relaunch) end the run loop without destroying windows, so the window-Destroyed handler never killed the daemon — the orphan kept the port and the next launch's daemon died on EADDRINUSE with no log line, leaving the UI silently talking to an old, contract-skewed daemon. The Tauri shell now also kills the daemon on RunEvent::Exit, reaps the child (no zombie), and watches for unexpected daemon exits, surfacing them through daemon:status. The daemon surfaces bind failures as logged fatal errors and reports its pid via /health so a stale port owner can be identified with one curl.
