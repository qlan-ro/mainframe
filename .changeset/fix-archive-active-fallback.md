---
'@qlan-ro/mainframe-ui': patch
---

Fix archiving the active session dumping you on the empty new-session screen.

assistant-ui's remote thread list calls `switchToNewThread()` off the archived
thread *before* marking it archived, so `mainThreadId` becomes a fresh
`__LOCALID_*` draft and the existing archived-active fallback (which keyed on the
active thread still being archived) never fired. The session router now remembers
the last real (non-draft) thread and, when an archive bumps you onto an empty
draft, redirects to a fallback session — the last-used one if still live, else
the most-recently-updated non-archived session, respecting the active project
filter. A deliberate "New" leaves the previous session regular, so it is not
redirected.
