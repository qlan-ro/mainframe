---
"@qlan-ro/mainframe-ui": minor
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-app-tauri": minor
"@qlan-ro/mainframe-app-electron": minor
---

Connect the desktop app to a remote daemon over the existing Cloudflare tunnel.
The app now talks to one daemon at a time — the local sidecar or a remote
daemon running on a server you control — switchable from a new daemon picker in
the sidebar footer.

The connection layer reads an active `DaemonTarget` (`{ id, kind, baseUrl,
token }`) across the HTTP, WebSocket, and LSP seams, injecting a bearer token
for remote daemons while local stays loopback-trusted and byte-for-byte
unchanged. Switching daemons remounts the daemon-scoped UI (keyed by daemon id),
tears down the WebSocket / LSP / chat-controller singletons and live PTYs via
`disposeDaemonSession()`, resets the daemon-scoped stores, and namespaces the
persisted `mf:last-session` / `mf:filterProjectId` / `mf:session-layout` keys by
daemon id so one daemon's session ids never bleed into another's.

Remote daemons are added with the existing device-pairing flow (verify the
tunnel URL, enter a 6-char pairing code → per-device token), reusing the daemon
routes unchanged. Per-daemon tokens are stored in the OS keyring on Tauri
(`keyring` crate) and via Electron `safeStorage`; the non-secret registry lives
in `~/.mainframe/remote-daemons.json`.

The footer shows the active daemon's connection state and offers
switch-to-local when a remote is unreachable; re-pair handles a rejected (401)
token. Local-only affordances are disabled under a remote daemon: "Reveal in
Finder", "Open externally", and the embedded preview tab. The terminal stays
laptop-local and its working directory falls back to home when the active
daemon is remote.
