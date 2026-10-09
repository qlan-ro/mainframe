---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Switch a chat between Claude and Codex without starting a new chat. After the first message, the provider tabs in the model menu show each provider's models; picking one asks to continue the chat there. The new provider gets a budgeted, verbatim selection of the chat's history with your next message, and going back to a provider that already ran in the chat resumes its earlier session with what happened since. A divider marks each switch in the thread. Switching is unavailable while a turn runs, while messages are queued, while background work is running, and in temporary or side chats; the tabs say why.
