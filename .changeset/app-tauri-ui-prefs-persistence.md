---
"@qlan-ro/mainframe-app-tauri": patch
---

Persist global UI chrome across reloads via a new unified `ui-prefs` store:
sidebar visibility, inspector visibility, sidebar width, and the bottom
Context/Skills/Agents panel's tab + height now survive a reload. The hand-rolled
`bottom-panel` store is folded in; sidebar/inspector visibility moves out of the
layout store. Per-session surface layout remains in-memory by design.
