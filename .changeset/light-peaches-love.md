---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Render Codex-generated images inline in the chat. Codex's `imageGeneration` thread item carries the PNG bytes as base64 in a `result` field (camelCase fields, not snake_case as previously typed); the event-mapper now decodes that inline payload directly and falls back to reading `savedPath` from disk only if the inline result is missing. The display pipeline's `convertAssistantContent` was also missing an `image` case, so even properly emitted assistant image blocks were being dropped before reaching the UI; that branch is now wired up. Image thumbs in assistant messages also no longer force right-justification.
