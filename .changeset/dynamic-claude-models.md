---
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-desktop": patch
---

Add dynamic Claude model list with CLI probe on startup

Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.
