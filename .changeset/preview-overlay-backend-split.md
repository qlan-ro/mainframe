---
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-ui": patch
---

The preview no longer blanks behind DOM overlays. A new `compositesAboveDom`
capability on `PreviewHandle` distinguishes the two backends: Electron's
`<webview>` is an in-DOM element that respects z-index, so overlays (the
annotation card, popovers, dialogs) now stack over the live preview instead of
hiding it. Tauri's native webview genuinely composites above the DOM and still
hides for overlays, so the annotation card now shows a freeze-frame of the
preview behind it rather than a blank pane.
