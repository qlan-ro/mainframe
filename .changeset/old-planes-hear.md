---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
'@qlan-ro/mainframe-types': patch
---

Surface live tunnel status in the Named Tunnel section. Both Named and Quick tunnels now share the same status hook (`useTunnelStatus`), the same status pill (gray when idle, yellow spinner while verifying, green when ready, yellow when DNS-unreachable), and the same Start/Stop semantics. Save errors are surfaced inline. The Quick Tunnel section is hidden when a token is configured (it controls the same underlying tunnel and was confusing duplication). Daemon `tunnel:status` events now carry a `label` so subscribers can filter, and `/api/tunnel/start` falls back to the persisted token + URL when called with no body — fixing a bug where clicking Start on a configured named tunnel spawned a quick tunnel instead. The Start/Stop button label was also flipping to "Stopping…" while a start was in flight; it now reflects the in-flight action correctly.
