---
'@qlan-ro/mainframe-e2e': patch
---

Speed up the Tauri e2e sweep by cutting per-describe fixture cost. The vite preview server and headless Chromium are now started once for the whole run and shared across describes (each describe still gets an isolated BrowserContext and a fresh daemon), and the first-run tour is suppressed before first paint so boot no longer double-navigates. Under `E2E_MODE` the Rust daemon also skips its login-shell PATH probe and the claude/codex `--version`/catalog refresh — both pure boot-time subprocess costs the mock suite never needs — dropping daemon readiness from ~3.5s to ~0.7s per describe.
