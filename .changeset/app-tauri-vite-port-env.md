---
"@qlan-ro/mainframe-app-tauri": patch
---

Honour `VITE_PORT` for the app-tauri dev server. The `dev` script hardcoded
`vite --port 5174` (and `vite.config.ts` pinned `server.port: 5174`), so the
`VITE_PORT` set in a launch/run config was ignored. The script now runs plain
`vite` and the config reads `Number(process.env.VITE_PORT) || 5174` — the
default keeps Tauri's fixed `devUrl` matching when `VITE_PORT` is unset.
