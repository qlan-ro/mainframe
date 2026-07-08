---
"@qlan-ro/mainframe-core": patch
---

Fix the packaged Tauri app hanging on "waiting for daemon". The daemon's CORS
allowlist only accepted `http(s)://localhost|127.0.0.1` origins, so it never
returned `Access-Control-Allow-Origin` for the packaged Tauri webview, whose
page is served from the `tauri://localhost` custom scheme (`http://tauri.localhost`
on Windows). WKWebView then blocked every daemon response as a CORS error and the
renderer's `/health` poll could never succeed — even though the daemon was healthy.
The allowlist now includes the Tauri webview origins.
