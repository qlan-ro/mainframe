---
'@qlan-ro/mainframe-ui': patch
---

Fixed three daemon-picker bugs: pairing a remote now auto-switches the app to it instead of silently no-op'ing on a stale registry snapshot; the "Paired" confirmation stays visible for its full grace window instead of closing instantly; and clicking Rename/Remove/Re-pair in a daemon's manage menu no longer bubbles into the row's own switch handler and wipes the dialog it just opened.
