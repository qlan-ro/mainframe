---
'@qlan-ro/mainframe-ui': patch
---

Stop a background history re-seed blanking a transcript that is already on screen. A reconnect or reattach re-reads history and replaces the thread wholesale, and the daemon answers "empty" for a chat it has no CLI session to read from yet — so one badly-timed re-seed emptied a populated thread until the next message arrived.
