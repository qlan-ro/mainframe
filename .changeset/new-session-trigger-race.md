---
'@qlan-ro/mainframe-ui': patch
---

Fix a second "New session" trigger (sidebar "+", tab-strip "+", ⌘N, or holding ⌘N past the OS key-repeat delay) arriving while the first draft was still initializing landing on the welcome screen's "Choose a project" state instead of staying scoped to the originating project. The draft's target now survives the initialization window, a same-target repeat is a no-op, discarding the draft returns to the session it was opened from, and auto-repeat ⌘N keydowns no longer start additional New-session sequences.
