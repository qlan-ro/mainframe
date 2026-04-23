---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Fix slash-command forwarding and skill detection

- Forward unknown `/cmd` input as plain user text so the CLI handles it natively, including its own "Unknown command" error messages (Fix A)
- Surface CLI-synthesized user text blocks (e.g. unknown-command feedback) as system messages in the chat; skip replayed user text and isMeta wrapper events (Fix B)
- Detect model-initiated SkillTool `tool_use` blocks in assistant events and fire `onSkillFile` so the skill appears in the ContextTab (Fix C)
- Add `onCliMessage` to `SessionSink` interface and implement it in `event-handler.ts` as a transient system message
