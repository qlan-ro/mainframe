---
'@qlan-ro/mainframe-app-tauri': patch
---

A session started with a slash command now gets a title. The daemon skipped its whole title path when the first message was a command, so the session stayed "Untitled" on every client, including the phone. It now derives the same fallback title from what you typed and replaces it with the generated summary moments later.
