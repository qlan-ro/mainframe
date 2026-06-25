---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-app-electron": patch
---

Represent grouped tool/task content as first-class typed `DisplayContent`/`PartEntry` variants (`tool_group`, `task_group`, `task_progress`) instead of sentinel tool-calls matched by name. `convertGroupedPartsToDisplay` is now an exhaustive typed switch with no `_ToolGroup`/`_TaskGroup`/`_TaskProgress` string-matching. Internal refactor with no behavioral change (scattered task-progress accumulation and dedup preserved).
