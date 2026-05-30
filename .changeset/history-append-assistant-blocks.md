---
'@qlan-ro/mainframe-core': patch
---

Extract the shared subagent block-flattening loop in the Claude history reconstruction into one `appendAssistantBlocks` helper. `collectAgentProgressTools` and `collectSubagentAssistantBlocks` derive their parentId/content differently but appended the tool_use/text/thinking blocks with byte-for-byte identical code; that logic now lives in one place. No behavior change.
