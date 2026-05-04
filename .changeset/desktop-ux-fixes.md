---
"@qlan-ro/mainframe-desktop": patch
---

fix(desktop): four UX fixes — transient update errors, sessions sidebar header layout, long user message collapsing, and composer double scrollbar

- #136: Transient auto-updater errors (network loss, DNS, 5xx, rate limits) no longer surface as a persistent error banner; logged at warn instead.
- #138: Sessions sidebar project group header row now uses a fixed-width right cluster so the project name never reflows when action buttons appear on hover.
- #139: User message bubbles longer than 600 characters are clamped to 6 lines with a "Read more / Show less" toggle.
- #140: Composer card caps at 14 lines via `maxHeight: 14lh`, uses `overflow-hidden` on the outer card to eliminate the double scrollbar, and sets explicit `lineHeight`/`padding` on the textarea to fix cursor offset on paste.
