---
'@qlan-ro/mainframe-app-tauri': minor
---

ChatSessionBar — the session status strip under the chat-card header (warm-chrome redesign of the desktop bar): adapter dot + name · model on the left, live status (Awaiting / Compacting / Thinking / Error / Worktree Missing) centered, and an 8-segment context meter with the CLI-reported usage percentage on the right. Branch and PR stay in the toolbar/header per the design. Wires the daemon's chat.contextUsage / chat.compacting / chat.compactDone events into the chat controller state.
