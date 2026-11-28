---
"@qlan-ro/mainframe-app-tauri": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-ui": patch
---

Chats nobody has open now give their history back to the system after 10 minutes idle, instead of keeping it until the two-hour idle cleanup. The chat keeps its running session, so returning to it or sending a message needs no restart, and the history reloads the way a first open does. Settings › General › Chats › Free memory of idle chats chooses 5, 10 or 30 minutes, 1 hour, or never. The two-hour idle cleanup now also frees the last copy of a chat's history it used to leave behind.
