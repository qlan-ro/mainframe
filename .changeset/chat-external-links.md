---
"@qlan-ro/mainframe-app-tauri": patch
"@qlan-ro/mainframe-ui": patch
---

Fix chat-transcript links doing nothing in the Tauri shell. The `opener:allow-open-url` capability was a bare permission string, which enables the command but grants no URL scope, so tauri-plugin-opener rejected every click. Scope it to http/https/mailto/tel plus the app schemes the markdown renderer linkifies (slack, vscode, cursor, zed, figma, linear, notion, …), and add a release-safety test that fails if the scope regresses to the bare string.
