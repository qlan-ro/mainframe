---
'@qlan-ro/mainframe-core': patch
---

Stop ghost subagent bubbles in live Claude sessions. CLI 2.1.118+ normalizes `agent_progress` events into top-level stream-json `user`/`assistant` events with `parent_tool_use_id` set to the parent's `Agent`/`Task` tool_use_id; without filtering, the subagent's prompt rendered as a system pill, its commentary as ghost assistant bubbles, and its tool_results as orphan rows in the parent thread. The Claude event handler now keeps only the structural blocks for `parent_tool_use_id != null` events — `tool_result` from user events and `tool_use` from assistant events — so the parent's Task card still shows live children and results, and the chatter stays out.
