---
'@qlan-ro/mainframe-ui': patch
---

Fix: a Codex chat with no model chosen could not send a message at all — the turn-start request omitted the required model field, and Codex rejected it with a raw protocol error. Codex turns now always name a model, falling back to the one the Codex app-server itself resolved and then to the configured default, and say so plainly if no model can be found.
