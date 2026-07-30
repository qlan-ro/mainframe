---
"@qlan-ro/mainframe-ui": patch
---

Fix attachments against a remote daemon: a stale device token used to fail the upload silently, drop the user's files from the composer, and show a bare "Failed to send" with no way back. A remote 401/403 now marks that daemon `needs-repair` in the footer (the stored token is untouched), the failed message names the cause (authorization, size, or unreachable) instead of a raw HTTP status, and the attachments the send consumed are put back into the composer instead of vanishing. Completing a re-pair swaps the live token in place, so the next send works without restarting the app.

The Rust daemon (`packages/core-rs`, not a changeset package) now logs one structured record per attachment-upload outcome and per rejected-auth request — accepted/rejected, count, byte total, reason — with no file names, bytes, or tokens. It also stops axum's default 2 MB body limit from shadowing the daemon's explicit 30 MB layer, which was silently rejecting any attachment over ~1.5 MB with an empty-bodied 413 on every daemon, local or remote.
