---
"@qlan-ro/mainframe-ui": patch
---

Render an assistant `error` turn as a styled destructive block (`AssistantErrorBlock` — `role="alert"`, destructive tint + alert glyph) instead of plain assistant prose. The projection sets `metadata.custom.mainframe.errorText` on the `error` case (keeping the text part for the ≥1-content-part/a11y invariant) and `AssistantMessage` branches on it.
