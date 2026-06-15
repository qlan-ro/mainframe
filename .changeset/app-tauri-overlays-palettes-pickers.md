---
'@qlan-ro/mainframe-app-tauri': minor
---

Port the overlay surfaces from the Electron renderer into app-tauri: a Cmd+O command palette (sessions + files on shadcn Command), a scoped find-in-path content search, a daemon-backed directory/file picker (promise-bridge hook), and a Cmd+Shift+R review modal (CmDiffEditor side-by-side diff + inline-comment-to-chat). Adds the searchContent API wrapper, an overlays store slice, and extracts shared file-search logic into use-file-search. FullviewModal is dropped (deferred with the plugins UI).
