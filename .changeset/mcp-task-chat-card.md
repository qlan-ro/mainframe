---
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-types': minor
---

A chat an agent delegated a task to now lives inside its parent's `delegate_task` card instead of the sidebar. Expanding the card shows the task chat's latest messages as they stream, with a link to open the full chat. When the task needs your permission or an answer, the card opens itself and you answer right there; the parent shows as waiting while any task below it does, and the push notification opens the parent. Task chats no longer appear in the sidebar, the archived list, or search, except one whose parent was deleted.
