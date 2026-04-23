---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Replace skill-injection grey bubble with a collapsible SkillLoadedCard

- Add `skill_loaded` content block type to `MessageContent` and `DisplayContent`
- Add `onSkillLoaded` to `SessionSink`; parse skill name, path, and content from the CLI-injected user-event text (`<skill-format>true</skill-format>`)
- Suppress `onCliMessage` for skill-injection text; emit `onSkillLoaded` + `onSkillFile` instead
- Cache the authoritative path extracted from the text so the `Skill` tool_use branch reuses it
- Wire `onSkillLoaded` through `event-handler.ts` as a transient system message with a `skill_loaded` block
- Pass `skill_loaded` blocks through `display-pipeline.ts` and `convert-message.ts` via message metadata
- Render skill messages as a `SkillLoadedCard` (collapsible, `defaultOpen={false}`) in `SystemMessage.tsx`
- New `SkillLoadedCard.tsx`: Zap icon + `/skillName` header with path tooltip; markdown body inside `max-h-[480px]` scrollable pane
