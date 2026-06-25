---
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-app-electron": minor
"@qlan-ro/mainframe-app-tauri": minor
---

Add the Electron HostBridge adapter and retrofit the desktop shell to host the
app-tauri renderer. Reshapes the preview port to `preview.mount(container, url,
opts) -> PreviewHandle` (per-project session partition), lands a Zod
`host-contract.ts` in mainframe-types with `Platform`/`DaemonStatus` enums, sends
terminal output as bytes over IPC, adds daemon port/status IPC, and points the
Electron window at the app-tauri Vite server (dev) / dist (prod) with a runtime
CSP for the daemon on 31415. The same renderer now runs on Tauri/WebKit and
Electron/Chromium, enabling a direct A/B. Plan 2 of 3; full Tauri parity
(updater/presence/log-sink/menu/diagnostics/bundling) follows in Plan 3.
