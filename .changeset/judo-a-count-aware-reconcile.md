---
"@qlan-ro/mainframe-app-tauri": patch
---

Reconcile optimistic messages with one count-aware matcher (review judo-A). Replaces
the windowed single-match live path, the Set-based authoritative history path, and the
attachment fallback loop with a single server-authoritative multiset matcher (each
server copy reconciles at most one pending, oldest first). Fixes the duplicate-text
over-clear (two identical sends with only one echo no longer drop the second) and the
empty-text wildcard match; deletes the 10-minute match window + `ignoreWindow` plumbing.
