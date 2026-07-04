---
"@qlan-ro/mainframe-app-tauri": patch
---

Add toast infrastructure (sonner). A `<Toaster />` (themed to warm-chrome) is mounted at
the app root, giving the controller a way to surface transient errors — such as a failed
agent run — as toasts. Unblocks the deferred composer rejection-toaster too.
