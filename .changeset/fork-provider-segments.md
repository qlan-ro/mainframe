---
'@qlan-ro/mainframe-ui': patch
---

"Fork from here" works in chats that switched providers: it forks from messages in the latest provider's part of the chat, and earlier messages say why they can't. A fork of a switched chat shows the earlier providers' messages read-only and continues the latest one. A fork that switches provider before its first message hands the parent's history to the new provider. Moving a switched chat into a worktree takes every Claude session it ran along, and tool calls from every provider in the chat fold the same way.
