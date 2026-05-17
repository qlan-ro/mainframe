---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Memory leak fixes: webview destroy, Monaco model dispose, trimmed Shiki languages, Claude CLI idle eviction (2h), renderer memory baseline logging (read via `app.getAppMetrics()` from the main process — the renderer has no `process`). Also fixes the preview webview hanging on "Waiting for localhost…" when the first navigation loses the race with the dev server: `loadURL` now retries with backoff instead of swallowing the error.
