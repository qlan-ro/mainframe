---
"@qlan-ro/mainframe-app-tauri": patch
---

app-tauri bugfix pass (carried-over review findings):

- **SurfDivider listener leak** — the resize divider attached `pointermove`/`pointerup`
  listeners to `window` on drag start but only removed them inside the `pointerup`
  handler, so unmounting mid-drag leaked the listeners (and kept firing `onFrac`). The
  in-flight teardown is now held in a ref and run on unmount via a `useEffect` cleanup.
- **`withGlobalTauri` release gating** — the base `tauri.conf.json` now sets
  `withGlobalTauri: false` so release builds ship no `window.__TAURI__`. A dev-only
  overlay (`src-tauri/tauri.dev.conf.json`) re-enables it for the MCP bridge, merged via
  `--config` in `pnpm tauri:dev`. A guard test locks the release-safe default.
