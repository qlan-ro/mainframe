---
'@qlan-ro/mainframe-app-tauri': patch
---

Codex errors from OpenAI now read as plain sentences instead of raw JSON. When Codex rejects every model because the ChatGPT subscription ended, the error says when it ended and asks you to renew and run `codex logout && codex login`. Rate limits, login failures, context-length overflows and OpenAI outages each say what to do next, and any other OpenAI error shows OpenAI's message with its status code.
