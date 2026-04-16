---
'@qlan-ro/mainframe-core': patch
---

Fix Claude CLI model probe silently timing out. The CLI wraps the initialize payload under `response.response` when `subtype === 'success'`, but the parser only checked `response.models`, so probing always fell back to the hardcoded model list.
