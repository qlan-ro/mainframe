---
"@qlan-ro/mainframe-app-tauri": patch
---

Overlay/palette artboard parity: make CommandDialog forward className + data-testid
so SearchPalette is spotlight-positioned (top 11vh, 580px) with a 54px/15px input
bar, uppercase command group headings, and a keyboard-hint footer (Navigate / Open
/ Dismiss). DirectoryPicker gets accent folder icons, a mono path breadcrumb strip,
and a chip-filled Cancel button. Add the missing root data-testids to SearchPalette,
DirectoryPicker, and FindInPath.
