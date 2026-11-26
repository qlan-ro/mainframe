---
'@qlan-ro/mainframe-ui': patch
---

The transcript no longer jumps to the bottom when a run starts by itself (a queued prompt, a background task, a resumed permission wait) while you are reading further up. Sending a message yourself always brings you back to the latest output. The scroll-to-bottom button now appears exactly when the transcript stops following. Images in answers keep a fixed-height box while they load, so the text around them no longer shifts.
