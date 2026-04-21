---
"@qlan-ro/mainframe-desktop": minor
---

Added the ability to delete a project from the sidebar. Two discoverable entry points route through the same confirm-and-cleanup flow:

- Hover the project group header (in the "All" view) → trash icon fades in next to "New Session".
- When filtered to a specific project, the active filter pill shows a chevron — clicking it opens a menu with "Delete Project".

Confirming stops all running CLI sessions in that project, removes all its chats from the database in a transaction, and resets any active filter or selected chat that belonged to the deleted project. Files on disk are not affected.
