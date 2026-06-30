---
"@qlan-ro/mainframe-ui": patch
---

UI Scale now works on both shells via a `HostBridge.setZoom` capability (Tauri `webview.setZoom`, Electron `webFrame.setZoomFactor`), and startup shows the same overlay card as reconnect ("Starting up…"). Responsiveness fixes: the composer config toolbar collapses its secondary pills to icons — Permission/Effort show labels when there's room (container query) — with a min-width floor and no label wrapping; the preview URL bar shrinks instead of hiding its buttons; and several flex rows (branch list, context section, model dropdown, review file toolbar) now truncate with `min-w-0` instead of overflowing.
