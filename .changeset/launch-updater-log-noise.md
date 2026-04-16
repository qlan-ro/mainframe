---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Downgrade launch spawn failures and auto-updater network errors to `warn` and drop stack traces. These are expected user-config / connectivity conditions, not application errors.
