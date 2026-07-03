---
"@qlan-ro/mainframe-ui": patch
---

Fix per-session workspace layout (surface placement + Run panes) not following
session switches — `useLayoutStore.setActiveSession` was fully built but never
wired into the runtime, so every session shared one global layout instead of
restoring its own. `useSessionListRouter` now calls `setActiveSession` (keyed
by the daemon chat id) whenever the active thread changes, restoring a visited
session's saved layout and seeding a never-visited one with the default. The
`__LOCALID_*` draft thread is skipped (no daemon chat id to key a workspace
off yet), so the previously active session's layout stays on screen until a
real session is activated.
