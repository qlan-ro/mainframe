---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix a chat that was created but never sent, a failed spawn, or a REST `/resume` that never started keeping its cached message history and registry slot pinned in memory indefinitely. These unspawned chats now become eligible for the same idle offload spawned sessions already get, releasing their cache and registry cell after the normal idle threshold while leaving the chat and its transcript intact for the next load or send.
