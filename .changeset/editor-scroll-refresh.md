---
"@qlan-ro/mainframe-ui": patch
---

Fix the editor jumping to the top when an open file is refreshed after an external change: applyValueUpdate now dispatches a minimal diff instead of replacing the whole document, so CodeMirror's scroll anchoring and selection mapping survive the reload.
