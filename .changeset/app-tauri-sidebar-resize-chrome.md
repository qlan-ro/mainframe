---
"@qlan-ro/mainframe-app-tauri": minor
---

Sidebar resize/collapse + surface-chrome batch for app-tauri.

- **Drag-to-resize/collapse sidebar:** a pointer-capture handle (`SidebarCollapseHandle`
  + `useSidebarResize`) drags the sidebar narrower to collapse past a threshold and
  wider up to a 640px cap, with a dim cue while a release would collapse, keyboard
  resize (←/→/Enter on the handle), and an unmount-safe cleanup. The collapsed surface
  chrome insets to clear the native traffic lights and the show-sidebar button, which
  now appears (and expands in one click) from both the button-hide and drag-collapse
  states.
- **Running indicator:** the "Thinking…" badge becomes a shimmering, rotating set of
  phrases (`useRotatingPhrase` + `.mf-text-shimmer`), reduced-motion aware.
- **Status bar:** shows "Daemon Connected" (port dropped) with bottom padding for
  vertical centering.
- Plus the accompanying session-sidebar/rows/tags, tool-card, gate, and surface
  strip/picker refinements and theme tokens.
