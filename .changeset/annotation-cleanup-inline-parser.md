---
"@qlan-ro/mainframe-ui": patch
---

Two small chat/preview cleanups: the capture annotation popover now uses the
shared Button/Textarea primitives and the warm-chrome popover shadow; and inline
`/command` highlighting now recognizes namespaced (`/plugin:skill`), path, and
dotted commands as a single token in both the composer and user messages.
