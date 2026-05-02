---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-desktop': minor
---

Render context-compaction events as a centered "Context compacted" pill instead of a plain system text bubble. Adds `{ type: 'compaction' }` to MessageContent / DisplayContent and a `CompactionPill` component used by `SystemMessage`. Live and history-replay paths both emit the new shape. As a small parallel change, `AssistantMessage.Fallback` now routes through the shared `renderToolCard` registry so tools without an explicit Tool UI registration still get their proper card.
