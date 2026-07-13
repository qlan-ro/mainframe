---
'@qlan-ro/mainframe-ui': patch
---

Fix toasts flickering when hovered.

Sonner's default collapsed stack clamps every toast to the front toast's height and re-lays the
stack out on hover. Our toast cards vary in height, so hovering moved a stacked toast ~314px out
from under the pointer, which un-hovered it, which moved it back — a visible flicker loop. The
toast stack is now always expanded, so hover changes no geometry.
