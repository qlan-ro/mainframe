---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

Sending a message with only file attachments and no typed text now shows up as a turn with its attachment pills, both live and after reloading the session. Previously the daemon stored the turn but two guards meant to hide internal CLI plumbing erased it, so the attachments reached the agent but never appeared in the transcript.
