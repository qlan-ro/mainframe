---
"@qlan-ro/mainframe-ui": patch
---

Switching back to a chat you just had open is faster. The chat keeps its turns, and settled replies and your own messages keep their parsed markdown, so coming back no longer parses every block again. Both caches have a memory budget. The kept turns are dropped when an older page loads, the window is trimmed, a jump opens a window around its target, or a display setting changes.
