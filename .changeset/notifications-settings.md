---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
---

Add Settings → Notifications page with per-category OS notification toggles.

Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.
