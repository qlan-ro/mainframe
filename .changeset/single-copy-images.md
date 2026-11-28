---
"@qlan-ro/mainframe-app-tauri": patch
---

Use less memory for open chats, most of all chats with images: the daemon keeps one copy of each image instead of one per internal history copy, and one copy of each displayed message instead of two.
