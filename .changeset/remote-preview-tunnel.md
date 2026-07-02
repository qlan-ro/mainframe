---
"@qlan-ro/mainframe-ui": minor
---

Remote-daemon preview tabs now load over the daemon's Cloudflare quick tunnel. Launching a `preview: true` launch config against a remote daemon previously did nothing visible (the tab was silently suppressed); it now opens a preview tab that shows a pending state while the tunnel comes up, loads the dev server over the tunnel URL, and falls back to a full-body process console with one explanatory toast on tunnel failure or a 20s timeout. Local-daemon previews are unchanged (still `http://localhost:<port>`).
