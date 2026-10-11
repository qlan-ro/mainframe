---
'@qlan-ro/mainframe-app-tauri': patch
---

Settings reads go through one shared contract. A damaged stored value (an unknown update channel, a malformed notification group) is reported with its safe default and logged instead of failing silently, and a notification update with a null value is rejected with a 400 instead of being ignored.
