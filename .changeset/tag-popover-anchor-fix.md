---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix session tag popover rendering off-screen: the root-mounted TagPopoverHost had no Radix anchor, so the popover positioned at the viewport origin. The row's Tags button now captures its rect and the popover anchors to it via PopoverAnchor.
