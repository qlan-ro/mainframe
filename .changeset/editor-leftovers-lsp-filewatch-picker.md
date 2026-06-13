---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Editor wrap-up leftovers: the LSP seam now actually works in the live app (port
init wired with a concurrency-safe promise cache, `textDocument/didOpen` sent on
load, extensions reconfigure when the client becomes ready, ready-state resets on
project/language switches); file watching accepts project-relative paths
(`subscribe:file` gains optional `projectId`/`chatId`, resolved worktree-aware
with containment and chat→project ownership validation; per-context subscription
keys; renderer map cleanup) and programmatic reloads no longer mark the buffer
dirty; new file-open command palette (`open-file-picker` intent, debounced
search, keyboard navigation) reachable from the empty state and the tab-strip +;
reveal-file expands and scrolls the file tree; shiki highlighting in the
markdown preview via a shared token renderer; diff tabs follow pre-resolved
content updates; viewers build valid encoded `file://` URLs and image metadata
loads; `blob:` CSP directives so PDF/SVG render in packaged builds.
