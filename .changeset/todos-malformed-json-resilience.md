---
'@qlan-ro/mainframe-core': patch
---

Tolerate malformed JSON in todos columns. `parseTodo` now routes `labels`, `assignees`, and `dependencies` through `safeJsonArray`, which defaults to `[]` and logs the offending row instead of throwing. Historical writes left some rows with double-encoded values that crashed `JSON.parse` and took down the whole Tasks panel; one bad row no longer hides the rest.
