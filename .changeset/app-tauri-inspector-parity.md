---
"@qlan-ro/mainframe-app-tauri": patch
---

Right Inspector panel — parity pass against the warm-chrome `04-engine` artboard and
the desktop FilesTab/ChangesTab references:

- **Glass panel:** `InspectorPane` now derives its surface from
  `windowStyleGeometry(windowStyle)` (same glass tokens as the left sidebar:
  `bg-mf-glass` + `backdrop-blur` + `rounded-[13px]` + `shadow-panel-soft`) instead of a
  hardcoded solid card, and reacts to the window style.
- **File-tree context menu** reaches desktop parity: a shared `FileTreeRowMenu` (files,
  folders, and the root header) adds **Reveal in Finder**, **Copy Path**, and **Copy
  Relative Path** alongside Find in file/folder, wired to the existing
  `showItemInFolder` / `writeToClipboard` helpers with the absolute worktree/project base.
- **Changes tab** now backs each scope with a distinct source: Session
  (`getSessionFiles`), Uncommitted (`getGitStatus`), Branch (`getBranchDiffs`, with a
  "Comparing &lt;branch&gt; against &lt;base&gt;" line) — previously all three showed the
  same uncommitted data. Both the tree and changes auto-refresh on the daemon's
  `context.updated` event and on window focus.
- **Token/colour alignment:** folder icon → brand accent, selected file weight, 12px
  folder rows, the root label's weight + letter-spacing, and the Changes scope switcher
  rebuilt to the artboard's track/button geometry.
