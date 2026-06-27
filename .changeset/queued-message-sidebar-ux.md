---
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-ui": minor
---

Queued messages: cancel and edit now work reliably. The daemon owns the queue and
flushes the next message to the CLI on run-end, instead of relying on an unimplemented
CLI cancel control request that made every cancel fail. Edit and Cancel now appear on
capture-only queued messages, the truncated capture-selector breadcrumb shows a tooltip
with the full selector, and clicking a project filter pill opens that project's
most-recent session.
