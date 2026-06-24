---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix new chats ignoring the configured provider permission default. app-tauri
hardcoded `permissionMode: 'default'` on the new-thread draft, which overrode the
daemon's `defaultMode` (so chats prompted per-tool even when the user's default
was `yolo`/`acceptEdits` — unlike desktop). The draft no longer seeds a mode and
chat creation omits it when unset, so the daemon applies the user's provider
`defaultMode`. A deliberate per-chat pick still takes effect.
