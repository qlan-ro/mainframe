---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

Fix two paragraphs running together with no blank line when a hidden tool call (Claude's TodoWrite, AskUserQuestion, ...) separated them — the hidden call is still never shown, but the text on either side now keeps its paragraph break.
