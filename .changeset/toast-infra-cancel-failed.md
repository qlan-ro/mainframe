---
"@qlan-ro/mainframe-app-tauri": patch
---

Add toast infrastructure (sonner) and surface queued-cancel failures. A `<Toaster />`
(themed to warm-chrome) is mounted at the app root; the controller raises a toast when
the daemon reports `message.queued.cancel_failed` (the message stays queued, which
previously had no user feedback). Unblocks the deferred composer rejection-toaster too.
