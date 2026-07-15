---
'@qlan-ro/mainframe-core': patch
---

Fix new chats getting created with no model when an adapter has no saved default-model setting (e.g. automation-created Codex chats), which made Codex's app-server reject the session with `Invalid request: missing field \`model\``. Chat creation now falls back to the adapter's own catalog default model, the same fallback already used for tuning resolution.
