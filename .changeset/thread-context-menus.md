---
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-e2e': patch
---

Copy file paths and quote text straight from a chat message.

Right-clicking a file path in a tool result offers Copy Absolute Path and Copy Relative Path. Both are derived from the same worktree and project roots that left-clicking the path opens with, so the path you copy and the file you open can never disagree. Markdown links keep their own copy/open menu, and paths inside a subagent transcript are left to the system menu.

Selecting text in a message raises a floating toolbar with Quote and New session. Quote adds the selection to the composer as its own quote with its own comment box, so several passages — including passages from different messages — can be quoted and sent as one message. New session opens a draft on the same project, prefilled with the selection. Neither action sends anything on its own. The editor's Add Agent Context now adds a quote the same way, and a quote carrying no comment can be sent for the first time.
