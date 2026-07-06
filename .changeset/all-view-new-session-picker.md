---
'@qlan-ro/mainframe-ui': patch
---

Fix: creating a session via ⌘N/Ctrl+N in "All" view (no project pill active), or booting into a workspace with projects but no sessions, no longer strands the user on a projectless dead-end thread. Both paths now open the same project picker the sidebar "+" button uses.
