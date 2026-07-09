---
"@qlan-ro/mainframe-core": patch
---

Fix subagent messages leaking into the main chat: partition task children by parentToolUseId (parallel and non-contiguous Tasks group correctly), end explore/progress grouping at subagent boundaries, surface in-content child tool_results, and suppress empty signature-only thinking blocks.
