---
"@qlan-ro/mainframe-app-tauri": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-ui": patch
---

Chats nobody has open, and that have no agent process running, now give their history back to the system after 10 minutes idle instead of keeping it until the two-hour idle cleanup. Returning to such a chat, or sending to it, reloads the history first, the way a first open does. If the history cannot be read back in full, the chat keeps it in memory, and a send asks you to try again rather than losing the message. Settings › General › Chats › Free memory of idle chats chooses 5, 10 or 30 minutes, 1 hour, or never. The two-hour idle cleanup now also frees the last copy of a chat's history it used to leave behind.
