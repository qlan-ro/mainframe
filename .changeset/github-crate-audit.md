---
"@qlan-ro/mainframe-app-tauri": patch
---

Stop a stalled GitHub request from leaving todo sync stuck as running, report GitHub's secondary rate limit as a rate limit instead of a credential failure, and keep the GitHub token from following pagination links off the API host.
