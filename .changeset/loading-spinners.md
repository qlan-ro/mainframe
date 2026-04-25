---
'@qlan-ro/mainframe-desktop': minor
---

Show a spinner while messages load on app startup and session switch. The chat panel now displays a centered Loader2 indicator instead of a blank area whenever `getChatMessages` is in flight, and the app-level center panel shows a loading state during the initial data fetch.
