---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

fix(codex): stop "Duplicate key toolCallId-default" crash when two subagents share a description

TaskGroup `agentId` now derives from the unique tool_use id instead of `taskArgs.description`, so two CollabAgent spawns in the same turn that resolve to the same role/description label no longer collide on assistant-ui's per-part React key. A defensive dedup pass in `convertMessage` guards the renderer against any future regression that lets repeated or empty toolCallIds through.
