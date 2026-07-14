# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.9

### Patch Changes

- [#462](https://github.com/qlan-ro/mainframe/pull/462) [`c213f85`](https://github.com/qlan-ro/mainframe/commit/c213f851c2790a391ec576f2e319c9ff32fb98ac) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix drag-and-drop not working on the Tasks kanban board, and add drag visual feedback.

  Tauri's native window-level drag/drop interceptor is enabled by default (`dragDropEnabled`), which swallows a drag session before the page's HTML5 `dragstart`/`dragover`/`drop` listeners ever fire. The kanban board (`TaskCard`/`TaskColumn`) and the composer's file-attachment dropzone both use plain HTML5 DnD (no native Tauri file-drop API is used anywhere), so setting `"dragDropEnabled": false` on the main window unblocks both without touching any OS-level file-drop feature.

  While fixing this, `TaskCard` now dims to 50% opacity while being dragged, and `TaskColumn` highlights with a tinted background and ring while a drag hovers over it — feedback that was previously invisible because the drag never reached the page at all.

- Updated dependencies [[`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f), [`bbd080f`](https://github.com/qlan-ro/mainframe/commit/bbd080fb33cff1bbe1bcba417e5b09ab85486549), [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3), [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af), [`c8db301`](https://github.com/qlan-ro/mainframe/commit/c8db301b70304c5936444327565591ff4412eabf), [`c213f85`](https://github.com/qlan-ro/mainframe/commit/c213f851c2790a391ec576f2e319c9ff32fb98ac)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.9
