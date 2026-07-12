---
'@qlan-ro/mainframe-ui': patch
---

Replace session status dots with provider logos and keep unread attention state independent of notification preferences.

Session rows now show provider-specific logos, use full-color/animated states for working and waiting sessions, and keep unread styling keyed to both stable thread ids and daemon chat ids. Pending permissions, waiting sessions, and completed/error lifecycle updates now mark background sessions unread even when OS notifications are disabled. Read session titles use normal foreground styling, while unread titles use a heavier weight.
