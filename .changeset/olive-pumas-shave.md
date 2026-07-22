---
'@qlan-ro/mainframe-ui': patch
---

Fix the crash on archiving a session ("Maximum update depth exceeded", React #185).

`useAdapters()` rebuilt its array on every render, and `useNewThreadAutoConfig` uses that array as an effect dependency — so the effect tore down and re-ran on every render. Both its body and its cleanup write to the store `ChatSurface` subscribes to, so each write re-rendered and re-armed it. Archiving the active session lands on an unresolved draft, which is the one state where that effect runs, so the loop crashed the window into the error boundary.

`useAdapters()` is now memoized on the catalog, and `ChatSurface`'s no-active-thread fallback selects a shared idle value instead of a fresh object literal.
