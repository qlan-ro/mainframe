---
'@qlan-ro/mainframe-ui': minor
---

Add a preview setting, Settings › Chat › "Mentions and commands as chips", off by default. With it on, the composer shows `@` and `/` tokens as atomic chips: the caret steps over one in a single press, Backspace deletes it whole, and undo, copy and paste keep it a chip. Tokens typed by hand become chips once finished, and quote segments and queued-message edits show chips too. The text sent to the agent does not change.
