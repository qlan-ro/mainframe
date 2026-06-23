---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix the chat Edit card's "Open in diff editor" button, which opened the plain
file instead of a diff. The `open-diff` surface intent now carries optional
`original`/`modified` sides, the intent subscriber forwards them into the diff
tab, and a new `openDiff` seam on `useOpenFile` emits it. `EditFileCard` routes
both the structured (full original/modified file contents) and fallback
(hunk-reconstructed) cases through it, so the button opens the proposed
original-vs-modified diff.
