---
'@qlan-ro/mainframe-app-tauri': patch
---

Title generation now leaves evidence when it gives up. A chat still falls back to the deterministic title taken from its first message, but each of the five ways the model-generated title can fail — the CLI exiting non-zero, an unknown adapter, an adapter with no title model, a chat closed before the title arrived, and a reply that fails the length check — now writes a daemon log line naming the reason. The CLI's own error output is captured (capped at 1 KB) instead of discarded, and a non-zero exit is treated as a failure rather than as an empty title.
