---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Fix the preview and external-file surfaces: out-of-project chat file paths now open read-only instead of erroring, reopened external files stay read-only, and the Tauri preview child-webview no longer races or leaks orphans on rapid create/destroy or device-toggle remounts.
