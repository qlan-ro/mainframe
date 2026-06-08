---
'@qlan-ro/mainframe-core': patch
---

Fix Codex sessions failing immediately with "Session ended unexpectedly". Non-fast turns were sending `serviceTier: 'flex'`, which models like gpt-5.5 reject with `400 Unsupported service_tier: flex`. The fast toggle now sends `serviceTier: 'fast'` only when on, and omits the field otherwise so Codex uses the account default tier. The failure reason from a failed Codex turn is now logged and surfaced in the error card instead of the generic message.
