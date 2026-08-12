---
'@qlan-ro/mainframe-ui': patch
---

Shrink the update pill so it fits the title-bar row it lives in.

"Install update — v2.0.0-rc.25 is available" measured 249px in a slot that is under 100px wide at the default sidebar width, and it rendered in bold primary — the loudest thing in otherwise muted chrome. The pill now reads Update / 47% / Restart, carries the version and the next step in its hint, and is built on the `Badge` primitive it used to hand-roll, so it inherits the focus ring and the 12px icon.
