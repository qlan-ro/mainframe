---
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-types': minor
---

Chats an agent delegated a task to now nest under their parent in the sidebar, marked as a task with its role, and their hover card names the chat that delegated them and the task's status. A chat with delegated tasks shows a chip in its header listing them with live status, and shows as waiting while one of them needs your permission; the push notification for that prompt names the parent. The `delegate_task` tool call renders as a card with the child chat's title, status, and an open link. Messages another agent queued for a busy chat appear above the composer until delivered, and each can be cancelled.
