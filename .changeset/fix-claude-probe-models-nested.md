---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.

- Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
- `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
- Claude adapter now has a hardcoded `default` entry as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one (e.g. Opus 4.7 on Max) when it succeeds.
- Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
- Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.
