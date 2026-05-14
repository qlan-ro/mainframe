---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

fix: don't peg context bar at 100% on 1M models

The Claude CLI's model probe doesn't report `contextWindow`, so the
probed catalog replaced the static one with entries that had no
window size. The renderer then fell back to a hardcoded 200k default,
so any chat on a 1M model (e.g. `default` → Opus 4.7 1M, `opus[1m]`,
`sonnet[1m]`) showed its context bar pegged at 100% as soon as usage
crossed 200k — even though the real window had ~720k headroom left.

Two changes:

- `ClaudeAdapter.probeModels()` now reconciles probed entries with
  the static catalog by id, with a description-string fallback
  (`"1M context"`) for ids unknown to the static list.
- `getModelContextWindow()` returns `undefined` for unknown models
  instead of silently defaulting to 200k. `ChatSessionBar` hides the
  progress segments and percentage when the window is unknown and
  the CLI hasn't reported a usage percentage of its own.
