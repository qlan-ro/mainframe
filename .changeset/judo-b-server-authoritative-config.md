---
"@qlan-ro/mainframe-app-tauri": patch
---

Composer config toolbar is now server-authoritative with NO optimistic edits (review
judo-B + #4/#6, mirroring the desktop client). The controller owns the chat config —
seeded from REST on load, then mirrored from every `chat.updated` — and the composer
reads it live; a control just sends the PATCH. This removes the optimistic-vs-broadcast
dual-writer race that made the plan/permission toggle flicker/revert. The
`chat.config.updated` reducer keeps the same state identity when no composer-relevant
field changed, so cost/token churn during a run no longer re-renders the toolbar.
