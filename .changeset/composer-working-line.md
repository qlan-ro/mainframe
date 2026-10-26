---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-types": patch
---

The status line above the composer now says what the turn is doing ("Reading src/app.ts", "Thinking", "Needs your input"). Its timer counts from when the turn really started, so it survives reopening a chat. It stays visible while background tasks run after the turn, showing "N running tasks", which opens the Activity panel.
