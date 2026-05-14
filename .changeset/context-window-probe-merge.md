---
'@qlan-ro/mainframe-core': patch
---

fix(core/claude): preserve model `contextWindow` after probe

The CLI's `claude` model probe doesn't report `contextWindow`, so the
probed catalog replaced the static one with entries that had no window
size. The renderer then fell back to a 200k default, and any chat on a
1M model (e.g. `default` → Opus 4.7 1M, `opus[1m]`, `sonnet[1m]`)
showed its context bar pegged at 100% as soon as usage crossed 200k —
even though the real window had ~720k headroom left.

`ClaudeAdapter.probeModels()` now reconciles probed entries with the
static catalog by id, falling back to a description sniff (`"1M
context"`) for IDs unknown to the static list.
