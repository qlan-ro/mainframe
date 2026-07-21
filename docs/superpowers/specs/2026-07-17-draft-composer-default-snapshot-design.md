# Draft Composer Default Snapshot Design

## Problem

A new-session draft can display fallback values that differ from the values the daemon resolves on first send. The draft composer currently loads provider settings asynchronously and represents several inherited fields as absent. Individual controls then choose local display fallbacks, while chat creation independently applies provider defaults. This caused an Interactive permission pill to become Unattended after sending and leaves similar risks for plan mode, model, effort, and model features.

## Goal

Before a draft composer becomes interactive, resolve and snapshot every visible session default. The composer and first-send creation path must consume the same snapshot. Later provider-setting changes must not alter an open draft.

## Scope

The snapshot covers:

- adapter
- model
- permission mode
- plan mode
- effort
- fast mode
- ultracode
- adaptive thinking

Project and worktree selections remain explicit draft values. Existing live-session configuration behavior remains unchanged.

## Design

### Default resolution

Add one pure draft-default resolver in the UI domain layer. It accepts the selected adapter, its model catalog, and its provider configuration. It returns explicit draft fields using daemon-equivalent precedence:

1. Use the configured provider model when it exists in the current catalog.
2. Otherwise use the catalog model marked as default.
3. Otherwise use the first catalog model.
4. Use the provider permission mode, or Interactive when absent.
5. Use the provider plan-mode default, or off when absent.
6. Resolve effort from provider default, then model default, then medium, clamped to supported values.
7. Resolve each feature from its provider default and clamp unsupported features to off.
8. When effective ultracode is on, resolve effort to `xhigh`, matching the daemon tuning resolver.

The resolver returns concrete values rather than inheritance sentinels. This makes the draft a stable snapshot.

### Initialization lifecycle

New-thread initialization must have the adapter catalog and provider settings before it marks the local draft ready. It creates `DraftCfg` with the selected project and the resolver's complete snapshot, then marks the local thread ready.

The project-filter entry path and the All-project picker path must call the same initializer. Neither path may construct a partial draft independently.

While initialization runs, the draft composer remains unavailable. If initialization fails, the UI retains the draft target and presents a retryable error instead of rendering guessed configuration. The implementation should reuse the existing loading or error surfaces where possible and avoid new layout work.

### Composer behavior

The toolbar reads explicit values from `DraftCfg`. Opening provider settings or changing defaults after initialization does not modify the draft. Toolbar actions continue to patch only the selected draft field.

Switching the adapter inside an empty draft is the one intentional reinitialization boundary. It snapshots the newly selected adapter's current defaults because defaults from the previous adapter are invalid. Explicit changes made after that switch remain stable.

### First send

The new-thread coordinator sends the draft's explicit model and permission mode to `createChat`. It applies explicit plan mode and tuning before spawning the first agent turn. The daemon receives no ambiguous missing value for a visible composer field.

Chat creation may still validate and capability-clamp values, but it must not replace a displayed draft default with a different provider default.

## Error handling

- Missing provider configuration is valid and resolves to product and model defaults.
- An unavailable configured model falls back to the live catalog default.
- A missing model catalog prevents readiness because the composer cannot show an authoritative model-dependent snapshot.
- Provider-settings request failures keep initialization retryable and log the failure through the existing UI error convention.
- Failed chat creation retains the completed snapshot so retry sends the same configuration.

## Testing

Add tests at three boundaries:

1. Pure resolver tests cover provider defaults, absent defaults, stale model ids, capability clamping, and ultracode effort coercion.
2. New-thread initialization tests prove both entry paths store complete snapshots and wait before marking ready.
3. Coordinator tests prove first send transmits and applies the stored snapshot without consulting changed provider settings.

Add a stability test that initializes a draft, changes provider defaults, and confirms the draft and toolbar values remain unchanged. Retain the permission-mode regression test that distinguishes an absent value from an explicit Interactive value.

## Acceptance criteria

- Every interactive draft control displays the exact value first send will use.
- No draft control shows a guessed fallback while provider defaults are loading.
- Provider-setting changes do not mutate an open draft.
- Switching adapters snapshots the new adapter's defaults once.
- Both new-session entry paths share the same initialization logic.
- Initialization and coordinator tests cover model, permission, plan, effort, and supported features.
