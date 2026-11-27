---
'@qlan-ro/mainframe-ui': minor
---

Add a preview setting, Settings › Chat › "Plain transcript list", off by default. With it on, every loaded message is a plain row under one scroll owner with browser scroll anchoring and no virtualizer, the newest rows mount first, and older pages land without moving what you are reading, including when you flick to the top. The top of the list shows a spinner with "Loading earlier messages" while a page loads, a cue while more is above, and "Beginning of conversation" at the start. The transcript no longer shows a scrollbar thumb in either list, and a chat that is still loading shows its spinner only if the load takes longer than 200 ms.
