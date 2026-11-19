# changelog-watch: codex rust-v0.169.0 → rust-v0.169.1 (2026-11-18)

Entries seen: 3 · risks: 1 · opportunities: 0 · relevant, no action: 0 · dropped as irrelevant: 2

The rust-v0.169.1 release notes say only "No verified release highlights available", so this pass read the three commits in `compare/rust-v0.169.0...rust-v0.169.1` and counts each commit as one entry. No app-server, notification or item shape changes: the diff touches `models-manager/models.json`, the Bedrock and GCP model providers, one line in `core/src/client.rs`, and test snapshots.

Checked by diffing `codex-rs/models-manager/models.json` between the two tags:

| slug | rust-v0.169.0 | rust-v0.169.1 | Mainframe `KNOWN_WINDOWS` |
| --- | --- | --- | --- |
| `gpt-6.2-sol` | — | 500,000, listed | absent → 272,000 default |
| `gpt-6.2-astra` | — | 272,000, listed | absent → 272,000 default (correct by luck) |
| `gpt-6.1-sol` | 272,000, priority 1, "Latest workhorse model…" | **500,000**, priority 4, "Previous generation model…" | 272,000 (now stale) |

No other slug's window changed. Both new models list efforts `low…ultra`, the same set `gpt-6.1-sol` already had.

## Compatibility risks

### low — Add GPT-6.2 Sol and Astra to model catalogs (#62106) (rust-v0.169.1)

- Checklist row: `CODEX-PROBE-02`. Consumer: `src/context_window.rs::KNOWN_WINDOWS`, read by `catalog_context_window` (`src/adapter.rs::map_codex_model` → `AdapterModel.contextWindow`) and by `known_context_window` (`src/turn_lifecycle.rs::resolve_context_window`, emission fallback).
- Why it threatens the row: the same commit adds `gpt-6.2-sol` at 500K and raises `gpt-6.1-sol` from 272K to 500K. The table has no `gpt-6.2-sol` row and still has `gpt-6.1-sol` at 272K. The UI gauge (`packages/ui/src/features/chat/thread/session-bar-status.ts::deriveContextPct`) shows the daemon's `contextUsage.percentage` when it has one. The daemon computes that from the wire's `tokenUsage.modelContextWindow` when present, so the gauge is right whenever the wire carries the window. Without the wire window, the two models differ. For `gpt-6.2-sol` the emission fallback finds no row and emits nothing, so the UI divides by the catalog default of 272K. For `gpt-6.1-sol` the emission fallback itself returns the stale 272K. Either way the context ring reads about 1.84× the real fill and hits 100% at 272K tokens, with 228K still free. Low, as with Terra on 2026-10-28 and 2026-11-01: it only shows when the wire window is missing, and the session keeps working. `gpt-6.1-sol`'s new description ("Previous generation…") and priority reach the picker as-is through `map_codex_model`, which is harmless.
- Recommended regression test: extend `src/context_window.rs` `mod tests`. Move `gpt-6.1-sol` out of `known_context_window_returns_the_272k_windows_for_current_models` and add `#[test] known_context_window_returns_the_500k_sol_windows` asserting `known_context_window(Some("gpt-6.2-sol")) == Some(500_000)` and `known_context_window(Some("gpt-6.1-sol")) == Some(500_000)`, plus `gpt-6.2-astra == Some(272_000)` in the 272K test. Refresh the module doc's snapshot tag to `rust-v0.169.1`. In `tests/list_models.rs`, pin a `model/list` entry `{"id":"gpt-6.2-sol","model":"gpt-6.2-sol","displayName":"GPT-6.2 Sol",…}` and assert the mapped `context_window == Some(500_000)`.
- Verify live: `.claude/skills/codex-protocol-debugger/`. After upgrading to 0.169.1, run a `gpt-6.2-sol` turn and confirm `thread/tokenUsage/updated` carries `modelContextWindow: 500000`.

## Adoption opportunities

None.

## Relevant, no action

None.

Dropped (2): "Enable incremental tools by default for Amazon Bedrock (#61426)" and "Normalize Bedrock Mantle commentary before replay (#62095)". Both apply only to the Amazon Bedrock model provider, which Mainframe never selects.
