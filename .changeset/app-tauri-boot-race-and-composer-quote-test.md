---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix two app-tauri reliability issues.

1. **Daemon boot race.** App mounted the data shell — and with it the initial
   projects/tags/threads REST loads — as soon as the sidecar port was known. But
   the sidecar opens its port before its HTTP server accepts requests, so those
   one-shot fetches hit a not-yet-listening daemon, failed, and never retried;
   the sidebar showed "No sessions yet" until a manual reload. `useConnectionState`
   now exposes a latched `ready` flag (set on the first successful `/health` poll,
   never reset), and App gates the shell mount on `ready && port != null`. The
   latch keeps the shell mounted through a transient post-boot blip.

2. **Composer test crash.** The Composer suite never stubbed
   `@/components/ui/assistant-ui/quote`, so the real `ComposerQuotePreview`
   rendered assistant-ui quote primitives that the hand-rolled `@assistant-ui/react`
   mock did not provide — all 11 tests threw at render. Stubbed the quote module,
   matching the existing toolbar/attachment/triggers stubs. Production code is
   unchanged.
