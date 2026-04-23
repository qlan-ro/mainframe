---
'@qlan-ro/mainframe-desktop': patch
---

Fix active-chat restore picking an archived session on boot. The daemon returns archived chats alongside active ones (they feed the archived-sessions popover), so `useAppInit.loadData()` must skip them when restoring `mf:activeChatId` — otherwise the right pane shows a chat that isn't visible in the flat list and the user can't navigate away.
