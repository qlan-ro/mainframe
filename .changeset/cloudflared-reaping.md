---
"@qlan-ro/mainframe-core": patch
---

Reap orphaned child processes on daemon startup and crash so neither a quick-tunnel child nor a launch-config dev server (and its process tree) keeps running after the daemon that spawned it dies. Tunnel and launch pids share one pidfile registry; the startup sweep only kills a live pid whose recorded command and cwd still match, and kills launch children by their process group so wrapper grandchildren (pnpm → vite → esbuild) die too.
