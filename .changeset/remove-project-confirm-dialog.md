---
'@qlan-ro/mainframe-ui': patch
---

Remove Project in the sessions sidebar now opens the app's own confirmation dialog instead of a browser dialog the desktop webview never renders, so the action works at all. A removal the daemon rejects raises an error toast carrying its message and leaves the project in the list, instead of reporting a false success.
