---
"@qlan-ro/mainframe-app-tauri": minor
---

Main-area header redesign: split the chat surface header into a shell-level
`MainToolbar` and a chat-zone `ChatCardHeader`.

- **`MainToolbar`** (new, above `SurfaceHost`): project name · worktree branch on
  the left; light/dark **theme toggle** wired (new `useTheme` store + root
  `ThemeEffect` toggling `.dark`). Search / launch / play / inspector / branch-switch
  are present-but-disabled gated stubs until their subsystems land. The show-sidebar
  button moves in-flow here.
- **`ChatCardHeader`** (new): today's chat header content (grip + icon + session
  title + split) lifted verbatim — the PR badge + session metrics attach here next.
- **Drag simplification:** `COLLAPSED_CHROME_INSET` + the absolute show-sidebar
  overlay retire; only the `MainToolbar` owns the collapsed traffic-light
  `leadingInset`, and `mainChromeInset` is removed from the surface path.
- `branchName` added to the `SessionCustom` projection as the shell's branch source.

Known limitation: the theme toggle does not recolor already-rendered code blocks
until reload (Shiki builds once) — deferred.
