---
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Region capture now selects inside the preview webview instead of behind a React
DOM overlay. The native preview webview composites above the DOM, so the old
overlay forced it to hide — you dragged the crosshair over a blank pane and the
resulting crop came back blank. The drag-select now runs inside the webview
(mirroring the element-inspect picker) on both the Electron and Tauri backends,
so the preview stays visible throughout the drag and the capture is a live frame.
