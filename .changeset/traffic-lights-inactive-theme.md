---
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-app-tauri": patch
---

The macOS traffic lights no longer vanish when the window loses focus in a
theme that differs from the system appearance. macOS draws the inactive
buttons for the window's appearance, and with the overlay title bar their
backdrop is the app content — dark-appearance inactive buttons are white,
invisible on the light theme. The native window theme now tracks the app
theme (`setWindowTheme` on the host bridge; System follows the OS).
