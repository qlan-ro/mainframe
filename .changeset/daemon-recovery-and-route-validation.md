---
"@qlan-ro/mainframe-core": patch
---

Tidy two daemon details from the gate-cards review: `recoverStaleWorkingState` now
resets orphaned `working` chats in a single `UPDATE … WHERE process_state='working'`
(with a `logger.info({count})`) instead of N per-row writes, and the
`GET /api/chats/:id/pending-permission` route Zod-validates its `:id` param like the
other routes.
