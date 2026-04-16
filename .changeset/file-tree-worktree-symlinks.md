---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Fix Files Tree in worktrees: "Copy Path" and "Reveal in Finder" now use the active chat's worktree path instead of the main project path. Also adds symlink support — symlinks to directories are expandable, symlinks to files are listed as files, and broken or out-of-project symlinks are skipped.
