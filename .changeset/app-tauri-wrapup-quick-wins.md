---
"@qlan-ro/mainframe-app-tauri": patch
---

Wrap-up quick wins (from the 2026-06-21 walkthrough):

- **File-tree collapse bug fixed** — a folder that was an ancestor of the last
  revealed file could not be collapsed (the reveal auto-expand effect re-opened
  it on every collapse). The auto-expand is now latched per `revealPath`. Adds a
  regression test.
- **Tooltips on truncated text** — new `TruncatedWithTooltip` helper (self-
  contained `TooltipProvider`) applied to session-row titles, file-tree rows,
  Changes rows, Files tab labels, and the Review file tree, revealing the full
  name/path on hover.
- **Tool-card status is dot-only** — dropped the redundant "Done/Failed/Running"
  word next to the status dot.
- **Review file rows** — the filename now keeps priority and the directory path
  truncates first (was the reverse), with a full-path tooltip.
