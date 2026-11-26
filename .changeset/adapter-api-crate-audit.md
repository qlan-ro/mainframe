---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix pull request links detected from Azure DevOps. A PR created with `az repos pr create` now links to the pull request page instead of carrying the command's whole JSON output as its URL. The provider list now updates as soon as a CLI is found to be installed or removed, even when its model list can't be loaded.
