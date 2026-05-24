---
'@qlan-ro/mainframe-desktop': patch
---

Preserve `askUserQuestion` on AskUserQuestion tool-call results when bridging to assistant-ui. The desktop converter was flattening the result to its raw `content` string, which left the renderer with `answered=false` — the card stayed collapsed and non-clickable, hiding all questions and answers from the user even though the daemon parsed them correctly.
