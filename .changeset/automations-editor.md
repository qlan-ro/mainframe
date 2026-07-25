---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-app-tauri': patch
---

Rebuild the automations editor around values you can name and reuse. Every text field in an automation now accepts `$name` references through the same picker, a Set value step names a result once so later steps can use it, and renaming that value rewrites every step that referred to it. Webhook triggers can be registered — and their URL copied — from the editor. Problems are reported on the step that caused them, including the ones the daemon finds at save time, which used to appear only as a toast.
