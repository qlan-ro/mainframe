---
'@qlan-ro/mainframe-ui': patch
---

Fix the zero-projects first-run screen never appearing: `reloadProjects` now shares one in-flight request across concurrently-mounted `useProjects()` consumers instead of firing a redundant fetch per mount, and `loading` now reflects only the initial load rather than flipping true on every reload — the latter previously caused an infinite mount/unmount loop between the first-run hero and the welcome screen on a fresh, project-less workspace.
