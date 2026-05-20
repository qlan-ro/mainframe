---
'@qlan-ro/mainframe-desktop': patch
---

Fix composer image attachments silently failing after the assistant-ui 0.14 upgrade. The library's new `fileMatchesAccept` only treats the literal `*` as a universal wildcard, so the adapter's `*/*` accept string rejected every file and nothing appeared in the composer for both the paperclip button and paste.

Attachment rejections (file too large, unreadable, unsupported type) now surface as an error toast instead of failing silently.
