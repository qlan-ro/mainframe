---
'@qlan-ro/mainframe-ui': patch
---

Codex sessions now receive image attachments. The daemon writes every image attachment to the chat's files
directory and hands Codex the resulting path; when an image can't be delivered, the turn still sends and the
transcript says how many images were dropped and why.
