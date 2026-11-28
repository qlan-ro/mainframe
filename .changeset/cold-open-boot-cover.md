---
"@qlan-ro/mainframe-ui": patch
---

The restored chat appears sooner at start and on reload: the startup cover lifts in the first frame the chat is drawn at its newest message, the app notices a just-started daemon within a tenth of a second instead of up to two, and the cover's spinner now shows whenever the restore takes longer than 400 ms.
