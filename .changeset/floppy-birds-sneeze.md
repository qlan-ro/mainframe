---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-desktop': minor
---

Nest subagent activity inside the parent's Task card on both live stream and history reload.

Replaces the prompt-suppression patches in PRs #264 and #267 with a uniform rule: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, and `TaskGroupCard` renders the new child kinds (text, thinking, skill_loaded) alongside the existing tool_call children. The dispatch prompt renders as an intro line at the top of the expanded card body.

History reload mirrors the live behavior: the subagent JSONL collectors now also extract text and thinking blocks (in addition to tool_use and tool_result), and every inlined block carries `parentToolUseId` so the same display pipeline produces identical output. Parent-level skill loads continue to surface at the chat root; subagent-context skill loads render as inner pills inside the Task card.

New `SessionSink.onSubagentChild(parentToolUseId, blocks)` method in `@qlan-ro/mainframe-types` is the entry point for subagent-tagged blocks. Internal-only API; no migration needed for adapters that don't emit subagent events.
