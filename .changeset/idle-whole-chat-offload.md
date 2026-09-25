---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

A Claude chat idle past 2 hours is now released as one unit instead of just having its CLI process killed: the daemon also drops the chat's cached message graph and removes it from the live-chat registry, and broadcasts a new `chat.offloaded` event. The desktop app drops the offloaded chat's controller and thread subtree (stashing the composer draft first), while the chat row stays visible and clickable in the sidebar. A chat with a pending permission request is never offloaded, so a session blocked on approval stays pinned. Reopening an offloaded chat shows a centered spinner over the empty thread while the daemon re-parses the chat's history from the Claude session transcript (resolved through the chat's stored transcript path, with the previous cwd-derived path as a fallback) and rebuilds the exact same message graph the chat showed live; sending the next message resumes the CLI session as before.
