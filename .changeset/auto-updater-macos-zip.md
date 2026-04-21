---
'@qlan-ro/mainframe-desktop': patch
---

fix(updater): publish macOS zip artifact so electron-updater can apply updates

Squirrel.Mac auto-updates require a `.zip` of the app bundle; the release previously shipped only `.dmg`, causing the updater to fail with "ZIP file not provided" when applying an update. Also replaces native `title` attributes on the status-bar update indicator and the composer worktree button with Radix tooltips so hovercards render with the app's own styling, re-enables hoverable content on the chat link-preview tooltip so the Copy button can be reached, and adds a right-click context menu to chat links with Copy link / Open link actions.
