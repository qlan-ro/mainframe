---
"@qlan-ro/mainframe-desktop": patch
---

Fixed diff editor gutter spacing on the modified side: restores `lineDecorationsWidth: 6` so there is breathing room between line numbers and code. Follow-up to the #113 horizontal-scroll fix — the clipping was caused by `overflow-hidden`, not the decoration width, so a non-zero value is safe now that the CSS is corrected.
