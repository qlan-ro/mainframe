---
'@qlan-ro/mainframe-ui': patch
---

Dismiss the image lightbox by clicking the image or the dimmed area around it.

The lightbox closed only on clicks that landed on the overlay — the empty bands above and below the image — because the image and the dimmed space beside it sit inside the dialog's content box. Clicking anywhere that is not a control now closes it; the prev/next buttons, the counter, Escape, and the close button behave as before.
