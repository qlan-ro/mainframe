---
'@qlan-ro/mainframe-ui': patch
---

Codex sessions now get an AI-generated title instead of the truncated first message. Titles are generated with `codex exec --ephemeral --ignore-user-config`, which leaves no session file, history entry, or thread row behind. Each adapter now titles with its own binary, so a machine with only Codex installed no longer shells out to `claude`; `provider.<adapterId>.titleBinary` still overrides it.
