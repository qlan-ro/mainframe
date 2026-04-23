---
"@qlan-ro/mainframe-desktop": patch
---

Fix element inspect screenshot offset when Electron zoom is not 1.0 (Cmd+/-). The crop rect passed to `capturePage` is now scaled by the webview zoom factor so device-pixel coordinates align with CSS-pixel coordinates from `getBoundingClientRect`.
