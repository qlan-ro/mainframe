---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-ui': patch
---

Fix three launch/preview races found during e2e verification: the REST launch-status endpoint could report a stale "stopped" instead of "failed" after a process exited (map-deletion race); a slow launch-config REST fetch could overwrite a fresher WS status update (toolbar/preview stale-overwrite); and a fast subprocess's stdout could be missed by the console pane if its whole spawn-output-exit lifecycle finished before the live WS event was observed (now replayed from a daemon-side output buffer).
