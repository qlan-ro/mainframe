---
'@qlan-ro/mainframe-core': patch
---

Close two issues from external review: validate the `attachmentId` path segment in `AttachmentStore.get` (a decoded `..%2F` could otherwise read another chat's attachments), and fix `isWithinBase` for a filesystem-root base so it no longer appends a double separator (a project rooted at `/` was wrongly rejected).
