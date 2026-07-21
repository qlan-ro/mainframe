---
'@qlan-ro/mainframe-ui': patch
---

Capture full diagnostics when a render error is caught. The error boundary now
logs the error stack and React component stack durably through the host (so
packaged builds record crashes without devtools), and "Copy details" copies the
full stack bundle instead of just the one-line message.
