---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
---

Review Panel modal: pre-PR review surface for the active chat. Cmd/Ctrl+Shift+R or the Review button opens a modal showing every changed file with a Monaco diff viewer (inline / split toggle) and gutter-comment widgets that post line-anchored comments back into the chat. Selection on added/removed lines is preserved and visible. Staging / commit / Open PR controls are not yet exposed in the UI; the matching git API surface ships behind it (`/api/git/stage`, `/unstage`, `/commit`, `/push`).
