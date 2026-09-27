---
'@qlan-ro/mainframe-app-tauri': minor
---

Adds daemon support for side chats (#344): a temporary, parented chat opened from any chat's own project, adapter and working directory, always empty and never listed as a session. `POST /api/chats/{id}/side-chat` opens or reveals a parent's one side chat; discarding it, archiving its parent, or removing its parent's project all tear it down. When the parent's adapter reports the no-persistence capability, the side chat's spawn carries that option through the existing temporary-chat spawn seam (#346) with no new adapter code — after a daemon restart its row and parent relationship survive but its conversation does not, and the next message starts a fresh vendor session.
