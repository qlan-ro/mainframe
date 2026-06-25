---
"@qlan-ro/mainframe-ui": patch
---

Persist each session's surface layout and split fractions across reloads. The
arrangement and divider positions are restored per session; live process-backed
Run tabs (terminals, previews, consoles) are intentionally dropped on reload so
nothing rehydrates onto a dead PTY or webview. Stale entries are garbage-collected
against the live thread list.
