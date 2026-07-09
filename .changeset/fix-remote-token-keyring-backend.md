---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix remote-daemon pairing: auth tokens now actually persist. `keyring 3.x` needs an explicit backend feature — without one it silently uses an in-memory mock store, so `daemon_token_get` always returned `None` and the renderer opened the daemon WebSocket with no `?token=`, getting rejected ("invalid or missing token"). The app looked "connected" (HTTP/health work) but never loaded projects/chats. Enable the real OS credential stores (`apple-native`, `windows-native`, `sync-secret-service`). No entitlement change needed — a signed, non-sandboxed macOS app accesses its own login-keychain items without `keychain-access-groups`.

Also make token storage fail loudly: `daemon_token_set` now returns a `Result` instead of swallowing keyring write failures, and the Add-remote dialog surfaces a distinct "couldn't save the credential" error instead of reporting a paired-but-tokenless connection as success.
