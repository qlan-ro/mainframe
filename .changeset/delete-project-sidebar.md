---
"@qlan-ro/mainframe-desktop": minor
---

Added the ability to delete a project from the sidebar. A trash icon appears on hover next to the "New Session" button on each project header. Confirming the prompt stops all running CLI sessions in that project, removes all its chats from the database in a transaction, and resets any active filter or selected chat that belonged to the deleted project. Files on disk are not affected.
