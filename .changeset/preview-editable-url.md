---
"@qlan-ro/mainframe-app-tauri": minor
"@qlan-ro/mainframe-ui": minor
"@qlan-ro/mainframe-types": minor
---

Preview tab: the URL is now an editable, two-way address bar. Type any URL and
press Enter to navigate the preview to it; the bar also reflects navigation that
happens inside the previewed app (link clicks, redirects, and SPA route changes),
like a real browser. Bare input (`localhost:3000/x`) gets an `http://` scheme;
invalid input is rejected without navigating.
