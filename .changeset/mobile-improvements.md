---
"@qlan-ro/mainframe-mobile": patch
---

Fix thinking indicator and chat updates, improve new session flow

- Call `resumeChat` when opening a chat so the daemon streams real-time events
- Add ThinkingIndicator component that pulses while the agent is working
- Restore pending permissions and refetch messages on WebSocket reconnect
- Add `createChat` and `resumeChat` methods to mobile DaemonClient
- Add FAB button on sessions screen to create new sessions with auto-navigation
