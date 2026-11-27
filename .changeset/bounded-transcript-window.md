---
"@qlan-ro/mainframe-ui": patch
---

In the plain transcript list (preview setting), the loaded history stays bounded: it shrinks to the newest page when you scroll back to the bottom. A jump to something not loaded (a Find match, an Activity row, a link) loads a window around it instead of everything in between, and scrolling on from it reaches the latest messages. Find in that list uses only daemon search.
