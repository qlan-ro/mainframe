---
'@qlan-ro/mainframe-core': minor
---

Codex tools now render with the same unified cards as Claude. The Codex event-mapper translates Codex-native item types into Claude-shaped tool_use blocks: commandExecution → Bash, fileChange → per-file Edit/Write with parsed unified-diff (structuredPatch), mcpToolCall → mcp__<server>__<tool> for the MCPToolCard wildcard. Codex adapter declares todo_list as hidden (parity with Claude TodoWrite — TasksSection integration tracked separately).
