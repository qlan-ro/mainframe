---
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Add a host-agnostic `HostBridge` port (Plan 1 of 3). The `HostBridge` interface lives in `@qlan-ro/mainframe-types`; the app-tauri renderer now reaches every native capability through `getHost()` / `useHost()` (backed by a `TauriAdapter` under Tauri and a `FakeHostBridge` in browser/dev and tests) instead of importing `@/lib/tauri/*` directly. Pure structural refactor — no behavior change.
