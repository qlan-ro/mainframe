# @qlan-ro/mainframe-types

## 0.10.3

### Patch Changes

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.
