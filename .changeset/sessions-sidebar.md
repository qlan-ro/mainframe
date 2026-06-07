---
'@qlan-ro/mainframe-app-tauri': minor
---

feat(sessions): sessions sidebar — grouped/filtered/pinned chat list on the
native RemoteThreadListRuntime. Adds the global thread-list runtime, controller
registry keyed by stable item.id, new-thread coordinator (__LOCALID_* → remoteId
on first send), active-gated WS subscriptions, project filter pills, tag
filtering + tag popover with rename/delete cascade, archive worktree dialog,
inline rename, pin/context menu, and WS-driven reload + unread store.
