---
"@qlan-ro/mainframe-core": patch
---

Fix the tunnel start timeout killing an already-connected tunnel while DNS
propagation was still in progress. The 45s start timeout now clears as soon as
the tunnel is established, so the DNS wait's own grace path ("emit URL
anyway") actually runs instead of racing a healthy tunnel to a SIGTERM.
