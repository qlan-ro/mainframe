---
"@qlan-ro/mainframe-desktop": patch
---

Skip the fixed 9222 Chrome DevTools port when running under e2e (`MF_E2E=1`). The harness launches Electron instances in quick succession; the fixed port collides between launches and makes suite runs flaky. Production and normal dev are unaffected (the port is still enabled when `MF_E2E` is not set).
