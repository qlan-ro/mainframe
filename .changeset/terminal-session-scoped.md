---
'@qlan-ro/mainframe-desktop': patch
---

fix(desktop): scope terminal tabs per session, preserve output across switches, and stop auto-creating tabs

Terminal panel now scopes tabs by active chat (session) instead of project — switching chats no longer leaks terminals between sessions. Output is preserved across project/session switches and panel minimize via a module-level xterm cache. The `+` icon now sits next to the tabs (not the far right), the close `×` is always visible, and an empty state prompts users to click `+` to start a session. No terminal is auto-created on mount — users open one explicitly.
