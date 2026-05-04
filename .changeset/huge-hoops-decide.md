---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Improve Quick Tunnel UX so "ready" only appears when the tunnel is actually reachable. The settings panel now distinguishes three live states driven by `tunnel:status` events: **Verifying DNS…** (cloudflared registered the connection but DNS hasn't propagated yet — yellow spinner, no pairing), **Ready** (DNS verified — green dot, pairing available), and **Unreachable** (DNS check timed out — yellow dot, "DNS not yet propagated" warning, Re-check button, pairing disabled). Also bump the daemon's DNS verification budget from 15s to 45s since trycloudflare.com URLs routinely take 20–30s to propagate on first start.
