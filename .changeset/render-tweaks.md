---
'@qlan-ro/mainframe-desktop': patch
---

Bundle of small chat-rendering polish:
- `ClickableFilePath` becomes `<span role="button">` with keydown handler instead of `<button>`, fixing the React hydration warning when nested inside another button (e.g. a tool-card header).
- Markdown code blocks render header inside the same container as the body (single border, copy icon always visible), fixing double-border and inconsistent header positioning.
- `SyntaxHighlightedCode` strips Shiki's default `<pre>` border/radius so it inherits the outer container chrome.
- `SearchCard` subheader aligns to 35px (icon column + padding) and the result divider is full-width.
- `WorktreeStatusPill` uses `my-2` for vertical rhythm parity with the rest of the pill family.
