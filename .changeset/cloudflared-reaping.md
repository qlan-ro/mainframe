---
"@qlan-ro/mainframe-core": patch
---

Reap orphaned cloudflared tunnels on daemon startup and crash so a quick-tunnel child no longer keeps running after the daemon that spawned it dies.
