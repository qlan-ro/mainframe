---
'@qlan-ro/mainframe-app-tauri': patch
---

Explain when a worktree was created but attaching the chat failed, and warn that some history files may already have moved.

Stop launch processes and public tunnels before deleting their worktree, including requests through path aliases. Read notification preferences without blocking chat events.

Report chat database failures instead of returning empty lists, missing chats, or an unsaved newly created chat.
