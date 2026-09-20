---
'@qlan-ro/mainframe-ui': patch
---

Typing an unrecognized `/` or `@` token in the composer no longer swallows Enter — the message now sends immediately instead of requiring Escape then a Send click. The same fix applies to automation trigger fields, where Enter now inserts a newline as intended.
