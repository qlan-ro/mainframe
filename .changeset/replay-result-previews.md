---
'@qlan-ro/mainframe-ui': patch
---

Open long chats with far less data: a full `session/resume` replay now sends tool results older than the newest twenty messages as short previews that expand on demand (the desktop client opts in; other clients keep full results), and the full-result route now reads Codex rollouts too, so expanding a truncated Codex result works.
