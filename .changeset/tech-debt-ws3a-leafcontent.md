---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-desktop': patch
---

Factor the four byte-identical leaf variants shared by `MessageContent` and `DisplayContent` into a single `LeafContent` type so the transcript and display unions stay in lockstep. Tighten `DisplayContent.permission_request.request` from `unknown` to `ControlRequest`, removing the downstream `as never` casts the erased type forced. Reuse `ToolCallResult` for the tool-card structured-result guard instead of a duplicated local type.
