---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-ui': patch
---

Extract shared task-progress result helpers (TASK_ID_RE/taskResultText/extractTaskId) into mainframe-types; harden the task card's streaming-id fallback against collisions with real task ids.
