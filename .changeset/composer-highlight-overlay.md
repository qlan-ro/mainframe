---
"@qlan-ro/mainframe-ui": patch
---

Highlight @mentions and /skills live in the composer input. A color-only overlay
renders behind a transparent-text textarea (sharing exact typography so the caret
stays aligned), reusing the same directive parser as the sent-message bubble.
