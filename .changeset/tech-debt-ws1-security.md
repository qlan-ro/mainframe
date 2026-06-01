---
'@qlan-ro/mainframe-core': patch
---

Close path-traversal, command-name and shell-interpolation seams. Fix a prefix-boundary bug in `resolveAndValidatePath` (a sibling dir sharing the base name prefix was admitted), consolidate the three divergent within-base checks onto one predicate, validate the `chatId` path segment in `AttachmentStore`, constrain the WS `command.name` to the identifier charset, and stop interpolating the probed command into the LSP `command -v` shell call.
