---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Open the last chat sooner after launch: the app asks for it as soon as the daemon answers, the daemon replies to the first resume before indexing the whole chat, and the adapter list and git reads no longer compete with the chat opening.
