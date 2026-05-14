---
'@qlan-ro/mainframe-desktop': patch
---

fix(desktop): enrich `render-process-gone` log payload

When the renderer crashes, the main-process log now also records the
URL, renderer OS PID, app uptime, RSS, and crashpad dumps directory.
The renderer PID matches the `pid` field in
`~/Library/Logs/DiagnosticReports/*.ips` so a crash log entry can be
matched to its system crash report without guessing by timestamp.
