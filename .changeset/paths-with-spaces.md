---
'@qlan-ro/mainframe-ui': patch
---

Fix files and folders whose names contain spaces. They now show in the Changes panel without quotes, open their diffs, stage and commit, and count their lines. The `@` picker can insert and browse them, writing `@"path with spaces"`. Go-to-definition and references work in projects whose path contains a space.
