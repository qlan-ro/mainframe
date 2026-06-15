---
"@qlan-ro/mainframe-app-tauri": minor
---

Port the Sandbox/Run preview-webview + capture cluster — the last deferred big item of
the desktop→Tauri migration. An embedded child webview (Tauri's `unstable` multiwebview)
renders a live preview of the project's dev server inside a Run pane, with native
WKWebView `takeSnapshot` capture (macOS; Windows/Linux return a clean unsupported error)
as the `<webview>.capturePage()` analog. Includes full-page + drag-region + element
(inspect) capture, an annotation popover, and the capture-to-chat send path (shared
sentinel round-trip with the existing receive-side projection); plus the daemon-backed
launch plumbing (LaunchPopover/StopPopover, sandbox store, scope-keyed status/logs,
console pane) wired through the live launch REST API and WS events — no daemon contract
change. The native preview layer tracks pane geometry and hides beneath overlays; closing
a pane reaps its webview.
