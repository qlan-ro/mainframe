---
"@qlan-ro/mainframe-core": patch
---

Emit `metadata.turnDurationMs` on turn completion so the chat message timing pill has data to render, and deliver `chat.notification`/`permission.requested` to every connected client instead of only ones subscribed to that chat, so background chats' completion and permission notices reach the sidebar's unread-dot/attention-badge features.
