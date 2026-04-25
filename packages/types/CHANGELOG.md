# @qlan-ro/mainframe-types

## 0.15.0

### Minor Changes

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.
