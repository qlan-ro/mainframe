---
'@qlan-ro/mainframe-desktop': patch
---

Fix four issues in the Check-for-Updates menu shipped in v0.18.0: the View-menu devtools filter was case-sensitive and didn't strip the item at runtime; existing submenu items lost their `type: 'separator'`, `click` handlers, and other properties when rebuilt; and the manual-check in-flight flag could leak permanently if `electron-updater` resolved without firing a terminal event. The filter is now case-insensitive, submenu items are passed through losslessly, and a 60-second watchdog clears the flag.
