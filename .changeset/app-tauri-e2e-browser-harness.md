---
"@qlan-ro/mainframe-app-tauri": patch
---

Two additive fixes that unblock browser-mode e2e and harden the app:

- **Daemon health poll uses the IPv4 loopback.** `useConnectionState` now polls
  `http://127.0.0.1:<port>/health` (via a new `healthUrl` helper) instead of
  `localhost`. The daemon binds `127.0.0.1` only, and `localhost` resolves to `::1`
  first on IPv6 hosts — so the previous URL could leave the UI stuck on
  "connecting" even though API/WS traffic on `127.0.0.1` worked.
- **Session rows expose `data-chat-id`.** `SessionRow` now carries
  `data-chat-id={item.id}` on the row element, so a specific session can be
  selected deterministically (used by the new app-tauri e2e harness and useful for
  any tooling that needs to address a row).

A browser-mode Playwright harness for app-tauri also lands under `packages/e2e`
(internal test infra, no published change): the daemon/mock plumbing is shared with
the Electron suite, and three grouped specs (sessions, chat, composer) run the
app-tauri Vite build in headless Chromium against a mock daemon.
