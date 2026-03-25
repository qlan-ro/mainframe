---
"@qlan-ro/mainframe-core": patch
---

fix(core): emit context.updated after tool_result instead of tool_use

Moves the context.updated event from onMessage (fires before tool execution)
to onToolResult (fires after). This ensures ChangesTab session-diffs and
EditorTab file refreshes see the completed data instead of racing with the
CLI tool execution.
