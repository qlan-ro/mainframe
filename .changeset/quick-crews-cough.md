---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
'@qlan-ro/mainframe-types': patch
---

Fix `file:changed` not refreshing the editor for paths the daemon resolved through a symlink (e.g. `/tmp` → `/private/tmp` on macOS). The daemon now sends a `subscribe:file:ack` event back to the requesting client carrying both the requested and resolved path; the editor accepts `file:changed` broadcasts that match either.
