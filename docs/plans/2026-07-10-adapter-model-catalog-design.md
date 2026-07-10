# Adapter Model Catalog Corrections

## Context

PR #395 materialized adapter catalogs so daemon startup never waits for a CLI probe. It also made live catalogs revisioned and replayable. Three provider-specific gaps remain:

1. Codex model discovery launches the bare `codex` command instead of the executable path resolved by the registry. A packaged desktop process can verify the configured binary but fail the subsequent catalog probe, leaving the UI on its empty fallback.
2. A chat without an explicit Codex model becomes an empty string inside collaboration settings. Codex CLI 0.144.1 rejects that value for ChatGPT accounts instead of treating it as the account default.
3. Claude CLI 2.1.206 returns both `default` and `opus[1m]`, and both resolve to `claude-opus-4-8[1m]`. Rendering both produces duplicate Opus 4.8 rows.

The current Claude catalog exposes 1M Default/Opus and Fable selectors, plus 200k Sonnet and Haiku selectors. It does not expose a separate 200k Opus selector.

## Decisions

### Preserve provider catalogs

Mainframe will show the choices returned by each installed CLI. It will not restore removed Claude choices from static data or maintain a static Codex model snapshot.

### Keep Claude's semantic default

Claude normalization will retain the `default` alias and remove later entries whose concrete `resolvedModel` matches the default entry. The retained row remains marked `isDefault` and uses the `Default - <model>` label.

This preserves account-tier default behavior when Claude changes the concrete default. It also avoids pinning new chats to today's explicit Opus identifier.

Deduplication applies only when both entries expose the same non-empty `resolvedModel`. Entries without that metadata remain untouched.

### Make Codex discovery path-aware

The Codex adapter will expose live model probing that accepts the registry's resolved executable path. Both temporary catalog app-server processes and real sessions will use the configured path rather than relying on the desktop process's `PATH`.

An empty or failed probe remains retryable under the registry behavior introduced by PR #395.

### Omit absent Codex models

When a chat has no explicit model, Mainframe will omit the model field from Codex thread and turn requests. It will also avoid constructing collaboration-mode settings with an empty model string.

Codex can then choose the default supported by the authenticated account. Explicit model selections continue to pass through unchanged.

## Data Flow

1. The registry resolves and verifies an adapter executable after executable-path backfill.
2. Claude or Codex probes that exact executable.
3. Claude maps the live response, retains the default alias, and removes only its concrete duplicate.
4. The registry publishes the normalized live catalog with a newer revision.
5. New Codex chats with no selected model omit model configuration; chats with a selection send the selected identifier.

## Error Handling

- Failed live discovery logs the provider error and leaves the fallback snapshot in place.
- Empty live results are not cached as successful, so a later registry refresh can retry.
- Alias deduplication does nothing when Claude omits `resolvedModel`; uncertain entries remain visible.
- No authentication type is inferred in Mainframe. Default-model compatibility comes from omitting an absent model for every Codex account type.

## Tests

Focused tests will cover:

- Claude mapping retains `default`, labels it as default, and removes an explicit alias with the same `resolvedModel`.
- Claude keeps distinct models and entries without resolution metadata.
- Codex live discovery launches the provided executable path.
- Codex thread start, thread resume, turn start, and collaboration settings omit an absent model.
- Explicit Codex model selection remains unchanged.

Core typechecking and the affected adapter test files will run after implementation.

## Non-Goals

- Inventing or restoring Claude model variants absent from the live CLI catalog.
- Adding a static Codex fallback catalog.
- Changing the revision/replay architecture from PR #395.
- Inferring provider account tiers or authentication methods.
