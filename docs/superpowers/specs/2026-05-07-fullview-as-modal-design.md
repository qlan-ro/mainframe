# Fullview Plugin Zone as Modal

**Date:** 2026-05-07
**Status:** Design

## Problem

The `'fullview'` plugin zone currently takes over the entire center area of the app: when a user clicks the todos icon in the LeftRail, `Layout.tsx` swaps the normal panel layout for `<PluginView pluginId={activeFullviewId} />`. This loses the user's surrounding context (chat panels, side zones, etc.) and feels heavier than warranted.

We want the same activation surface and store mechanism, but render the contribution as an overlay modal — like `ReviewPanel` — so the underlying layout stays visible behind a dimmed backdrop.

## Scope

The change applies to the entire `'fullview'` zone concept, not just todos. Today todos is the only plugin registering in `'fullview'`, but any future plugin contributing to that zone will get the same modal treatment.

## Design

### Rendering surface

A new component `FullviewModal` (`packages/desktop/src/renderer/components/modals/FullviewModal.tsx`) renders the active fullview plugin as an overlay modal:

- **Backdrop:** `fixed inset-0 bg-mf-overlay/60 z-50 flex items-center justify-center`
- **Card:** `flex h-5/6 w-5/6 flex-col rounded-lg border border-mf-border bg-mf-app-bg shadow-2xl` (matches `ReviewPanel` shell exactly)
- **Header:** thin chrome bar above the plugin body
  - Left: `{label}` from the active plugin contribution, styled `uppercase` via Tailwind (e.g. `text-xs uppercase tracking-wide text-mf-text-secondary`)
  - Right: `X` close button (lucide `X` icon, same treatment as `ReviewPanelHeader`)
- **Body:** `<PluginView pluginId={activeFullviewId} />` filling the remaining height

The label is read from `usePluginLayoutStore`'s `contributions` array — find the contribution whose `pluginId === activeFullviewId` and `zone === 'fullview'`. The modal styles `label` as uppercase in the header so plugins keep human-readable labels in their manifest.

### Mounting

`FullviewModal` is mounted at the app root in `App.tsx`, alongside `ReviewPanel`. It is not part of `Layout`. This keeps the underlying layout fully rendered behind the overlay.

### Close behavior

The modal closes via:

- Click on backdrop (outside the card)
- `Escape` key (global keydown listener while open)
- Click on the `X` button in the header

All three call `activateFullview(activeFullviewId)`, which toggles the current id off (existing store behavior — see `plugins.ts:91-94`).

### Layout changes

`Layout.tsx` removes the `activeFullviewId ?` conditional (lines 115-119). The center area always renders the normal panel layout. The modal is no longer Layout's concern.

### Unchanged

- **Store** (`store/plugins.ts`) — `activeFullviewId`, `activateFullview`, contribution registration all unchanged.
- **LeftRail** (`components/LeftRail.tsx`) — buttons still toggle `activateFullview`. Active state still derived from `activeFullviewId`. Visual treatment unchanged.
- **`UIZone` type** — `'fullview'` literal kept. Renaming would touch the public plugin manifest contract, types, and tests for no functional gain.
- **`PluginView`** — unchanged. Still renders the registered fullview component for the given pluginId.
- **TodosPanel** — unchanged. Its existing internal header sits below the new modal chrome bar.

### Multiple fullview plugins

Existing semantics preserved: only one `activeFullviewId` at a time. If two plugins register in `'fullview'`, each gets its own LeftRail button; activating one closes the other.

## Files

| File | Change |
|------|--------|
| `packages/desktop/src/renderer/components/modals/FullviewModal.tsx` | **New** — overlay modal shell with header + close handlers |
| `packages/desktop/src/renderer/components/modals/index.ts` | Export `FullviewModal` |
| `packages/desktop/src/renderer/App.tsx` | Mount `<FullviewModal />` next to `<ReviewPanel />` |
| `packages/desktop/src/renderer/components/Layout.tsx` | Remove `activeFullviewId` branch (lines 115-119); always render normal panel layout |

## Testing

- Existing `plugins.test.ts` continues to pass (store contract unchanged).
- New integration test (`FullviewModal.integration.test.tsx`) parallel to `ReviewPanel.integration.test.tsx`:
  - Modal not rendered when `activeFullviewId === null`
  - Modal rendered with header label (uppercase) and close button when `activateFullview('todos')` called
  - Backdrop click closes the modal
  - Escape key closes the modal
  - Close button closes the modal
  - Header shows the contribution's `label`, styled uppercase

## Out of scope

- Renaming `UIZone`'s `'fullview'` literal
- Changing the LeftRail button behavior or styling
- Modifying the todos plugin's internal layout or header
- Animations / transitions on open/close
