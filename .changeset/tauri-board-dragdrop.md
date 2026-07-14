---
'@qlan-ro/mainframe-app-tauri': patch
'@qlan-ro/mainframe-ui': patch
---

Fix drag-and-drop not working on the Tasks kanban board, and add drag visual feedback.

Tauri's native window-level drag/drop interceptor is enabled by default (`dragDropEnabled`), which swallows a drag session before the page's HTML5 `dragstart`/`dragover`/`drop` listeners ever fire. The kanban board (`TaskCard`/`TaskColumn`) and the composer's file-attachment dropzone both use plain HTML5 DnD (no native Tauri file-drop API is used anywhere), so setting `"dragDropEnabled": false` on the main window unblocks both without touching any OS-level file-drop feature.

While fixing this, `TaskCard` now dims to 50% opacity while being dragged, and `TaskColumn` highlights with a tinted background and ring while a drag hovers over it — feedback that was previously invisible because the drag never reached the page at all.
