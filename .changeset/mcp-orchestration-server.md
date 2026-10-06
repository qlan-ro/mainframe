---
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-types': minor
---

Agents can now see and drive other Mainframe chats. Every Claude and Codex chat gets a `mainframe` MCP server with tools to list, read, and wait on chats, launch new ones, send or steer messages, interrupt a turn, and delegate a task to a child chat whose result comes back as a message once the parent is idle. Stopping a chat also stops the work it delegated. Messages another agent wrote now appear as cards naming the sending chat instead of as your own messages.
