---
'@qlan-ro/mainframe-ui': patch
---

Fix a resume (reconnect mid-stream) briefly dropping the in-flight reply's text until the next partial arrived. A `session/resume` snapshot now includes the same in-flight overlay and streaming attribution a live update would show at that moment, so the replayed text matches what was already on screen.
