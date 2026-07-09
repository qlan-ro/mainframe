---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-ui': patch
---

Fix the context meter over-reporting (stuck near 100%): persist the CLI-reported context totals on the chat row and prefer them over the catalog-window estimate; resolve probed model windows via each entry's own resolvedModel; stop subagent, synthetic zero-usage, and cumulative result usage from corrupting the stored context size.
