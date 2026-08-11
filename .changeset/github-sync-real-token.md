---
'@qlan-ro/mainframe-ui': patch
---

GitHub sync: store a real personal access token instead of the Automations placeholder. The link dialog now takes a pasted PAT, the sync pill menu gains "Update GitHub token…", and an auth failure in the import dialog shows a readable message with a one-click path to fix the token. The daemon also stops offering pull requests as importable issues.
