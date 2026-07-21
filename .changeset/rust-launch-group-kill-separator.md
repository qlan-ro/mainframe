---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix the Rust daemon's process-group kill silently doing nothing on Linux. `kill -TERM -<pid>` without `--` is parsed as a signal spec by Linux `kill`, which exits 0 without delivering — so stopped launch children (and sweep targets) were never signalled and ran until natural exit. Both group-kill shell-outs now pass `--` before the negative pid.
