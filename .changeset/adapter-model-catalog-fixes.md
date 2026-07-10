---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-core': patch
---

Keep adapter model catalogs aligned with installed CLIs: Codex discovery now uses the configured executable, unset Codex models inherit the account default, Claude removes the explicit alias that duplicates its semantic default, and stale saved provider defaults no longer leak raw model ids into new chats.
