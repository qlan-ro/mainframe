---
"@qlan-ro/mainframe-app-electron": patch
---

Fix a WS14c rendering regression: explore-tool groups and progress feeds run by a subagent are nested as first-class `tool_group`/`task_progress` blocks inside `task_group.calls`, but `convertMessage`'s task-group child mapper dropped them (returned `null`), so a subagent's file reads/greps and progress vanished from the Task card. The mapper now re-encodes nested `tool_group`/`task_progress` as `_ToolGroup`/`_TaskProgress` tool children — matching the top-level encoding that `TaskGroupCard` already renders and summarizes — restoring the pre-WS14c behavior.
