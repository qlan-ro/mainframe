---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix stale frontend assets surviving app updates (root cause behind the "still broken" scrollbar reports on #438/#443/#446).

Tauri's asset protocol sends no `Cache-Control`/`ETag`/`Last-Modified` headers, and since the `tauri://` origin never changes between app versions, WKWebView's disk cache could keep serving `index.html` and its referenced JS/CSS from a pre-update session after an in-place update — with no way to tell it was stale. Three separate scrollbar-CSS fixes shipped correctly but kept getting masked by this. The main window is now built manually (`"create": false` in config) with `on_web_resource_request` attaching `Cache-Control: no-store` to every asset response, so each request always hits the current bundle.
