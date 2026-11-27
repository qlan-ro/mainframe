---
'@qlan-ro/mainframe-ui': patch
'@qlan-ro/mainframe-types': patch
---

History windows are sized by whole turns. A chat opens on its last N turns and each older page adds N more, so the transcript never starts mid-turn. N is set in Settings, Chat, "Turns to load at a time" (default 10, 2 to 50). The daemon drops whole turns from the top of a window that encodes to more than about 1 MB. Requests without `turns` behave as before.
