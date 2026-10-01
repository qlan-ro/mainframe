---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

Fix long chats (over 2000 messages) re-rendering old turns at the bottom of the transcript, showing raw tool-use ids as tool names, and reloading the whole history on every new message. Live replies now animate only the text that is actually streaming, and the final snippet no longer pops in at the end of a turn.
