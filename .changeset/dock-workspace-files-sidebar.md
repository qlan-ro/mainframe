---
"@qlan-ro/mainframe-ui": minor
---

The Workspace surface's Files panel is now a persistent docked sidebar on the right edge instead of a floating overlay — it resizes the content pane rather than covering it, and stays open across file picks. Its open state persists per project/worktree, and it closes only via its own toggle (no more light-dismiss on Escape or an outside click). The trigger icon changed from a folder glyph to `PanelRight`, mirroring the left sidebar's static `PanelLeftIcon`.
