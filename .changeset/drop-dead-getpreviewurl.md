---
'@qlan-ro/mainframe-core': patch
---

Remove the unused `getPreviewUrl` export from the launch module. It had no production callers — preview URLs are derived independently by the status handler — so the function, its barrel export, and its tests are deleted.
