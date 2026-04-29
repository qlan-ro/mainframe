---
'@qlan-ro/mainframe-core': patch
---

Stop the duplicate "subagent prompt" pill in live Claude sessions. CLI 2.1.118+ normalizes `agent_progress` events into top-level stream-json messages with `parent_tool_use_id` set; the subagent's first event is a string-content user message that just restates the dispatch prompt — the same text already rendered by the parent's Task card from `Agent.input.prompt`. The Claude event handler now drops just that one event (string content with `parent_tool_use_id` set and no CLI-internal tags). Subagent skill loads, text/thinking, tool_use and tool_result blocks all flow through unchanged.
