---
"@qlan-ro/mainframe-app-tauri": minor
---

Make the session-sidebar "Add project" pill live: pick an existing directory,
register it with the daemon, and refetch the project list. Adds a createProject
REST client (handles the daemon's 409 already-registered case) and a useAddProject
hook composing the directory picker, project create, list refetch, and toast. The
active project filter is left unchanged on add.
