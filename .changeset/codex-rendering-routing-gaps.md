---
'@qlan-ro/mainframe-app-tauri': patch
'@qlan-ro/mainframe-ui': patch
---

Close four Codex routing gaps that dropped or mis-rendered content in the chat view.

Diff-unavailable edits now fall back to a plain message instead of an empty `EditFileCard`. A `Task` item with no recorded subagent children still renders as a `TaskCard` rather than vanishing. `imageGeneration` items with an inline result now survive a chat reload instead of being dropped by history conversion. `webSearch` items are now routed to the existing `WebSearch` tool card (registered in `register-cards.ts`) in both the live stream and history reload, emitted as an already-complete tool-use/tool-result pair since Codex never sends a separate result event for it.
