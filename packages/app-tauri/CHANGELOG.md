# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.3

### Patch Changes

- [#411](https://github.com/qlan-ro/mainframe/pull/411) [`f3754e6`](https://github.com/qlan-ro/mainframe/commit/f3754e69e123930d4ec78604f6332632e81117f0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix packaged Tauri daemon launch defaults so clean app launches use port 31415 and the default Mainframe data directory unless explicitly overridden.

- [#412](https://github.com/qlan-ro/mainframe/pull/412) [`704799b`](https://github.com/qlan-ro/mainframe/commit/704799b92dcd3341b729e3e6e06d761314af2312) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview capture toolbar in the Tauri app. Inspect-element and region-capture never worked: the preview child webview loads a remote origin, so Tauri's ACL silently denied every callback it invoked (picker results, navigation tracking, external-link opening). Those four callbacks now live in an inlined `preview-bridge` plugin granted to `preview-*` webviews via a remote capability. Screenshot annotation showed a blank preview in packaged builds: the production CSP blocked `data:` images, hiding the freeze-frame backdrop and capture thumbnails — `img-src` now allows `data:`. The annotation dialog also rendered _behind_ the live preview: a recreated webview is shown by default, but the visibility hook's dedup cache still held the old webview's state and suppressed the `setVisible(false)` that hides it — so the native webview composited over the annotation UI until a reload. The cache now resets whenever the webview is recreated.

  The capture toolbar's inspect/region/screenshot state is also cleaned up: inspect and region are now mutually exclusive toggles (selecting one cancels the other, clicking the active one turns it off, and a completed pick clears it), and the Restart glyph no longer duplicates the URL-bar reload icon. "Open in browser" now opens the current preview URL in the OS browser instead of silently re-navigating the embedded webview, and "Clear cache" clears the webview's Cache-API/storage entries and reloads instead of doing a plain navigate. The toggle-off teardown and "Clear cache" are implemented on both hosts (Tauri and Electron); on Electron, Clear cache also reloads bypassing the HTTP cache. Separately, an empty Run surface now keeps its split/close controls instead of hiding them behind the picker.

- Updated dependencies [[`1e376ba`](https://github.com/qlan-ro/mainframe/commit/1e376babf480d38b43d723cfbe32c18b78c226b3), [`704799b`](https://github.com/qlan-ro/mainframe/commit/704799b92dcd3341b729e3e6e06d761314af2312), [`48218b7`](https://github.com/qlan-ro/mainframe/commit/48218b7e4654ad592ad361b0c5c67fe27e57cf7f)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.3
