---
'@qlan-ro/mainframe-ui': patch
---

Fix the daemon picker: pairing's auto-switch is deferred until after the "Paired" dialog closes (no more remounting the shell out from under an open dialog), the picker popover no longer closes itself when a nested rename/remove dialog dismisses, and switching back to the local daemon restores its real port instead of a stale remote one.
