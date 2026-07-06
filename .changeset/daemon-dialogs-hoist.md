---
'@qlan-ro/mainframe-ui': patch
---

Daemon add/rename/remove dialogs now render from a root-level host above the keyed daemon shell, so switching daemons no longer destroys an in-flight pairing confirmation or dialog; the rename/remove dialog also no longer closes the daemon picker when it opens or dismisses.
