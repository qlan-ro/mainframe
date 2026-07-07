---
'@qlan-ro/mainframe-app-tauri': patch
'@qlan-ro/mainframe-ui': patch
---

Fix the preview capture toolbar in the Tauri app. Inspect-element and region-capture never worked: the preview child webview loads a remote origin, so Tauri's ACL silently denied every callback it invoked (picker results, navigation tracking, external-link opening). Those four callbacks now live in an inlined `preview-bridge` plugin granted to `preview-*` webviews via a remote capability. Screenshot annotation showed a blank preview in packaged builds: the production CSP blocked `data:` images, hiding the freeze-frame backdrop and capture thumbnails — `img-src` now allows `data:`. Also, the Inspect button no longer stays lit after a successful pick.
