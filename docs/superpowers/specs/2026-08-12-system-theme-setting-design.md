# System Theme Setting Design

## Goal

Add a System appearance preference beside Light and Dark. System follows the operating system's color scheme at launch and whenever it changes.

## User Experience

Settings > General > Appearance shows three Mode choices in this order: System, Light, and Dark. Unset or invalid stored preferences resolve to System.

System applies the current `prefers-color-scheme: dark` result. The app updates immediately when that media query changes. Light and Dark remain fixed until the user chooses another preference.

The toolbar theme button remains a quick override. It displays the resolved appearance and selects the opposite fixed preference when clicked. Users select System from Settings.

## State Model

The theme store separates the user's preference from the appearance currently rendered:

- `mode: 'system' | 'light' | 'dark'` stores the preference and drives the Settings selection.
- `resolvedMode: 'light' | 'dark'` drives rendered colors and theme-aware consumers.

`setMode` persists the preference and recalculates `resolvedMode`. A store action updates `resolvedMode` after an operating-system theme change, but only while `mode` is `system`.

The existing `mf-theme` local-storage key remains canonical. Missing, unavailable, or unrecognized values resolve to `system`. Existing `light` and `dark` values retain their behavior.

## Theme Application

Before React mounts, `applyStoredTheme()` reads the preference, resolves System through `window.matchMedia('(prefers-color-scheme: dark)')`, and sets the root `.dark` class. If `matchMedia` is unavailable, System resolves to Light. This preserves the existing flash-of-incorrect-theme guard.

At runtime, `ThemeEffect` applies `.dark` from `resolvedMode`. It subscribes to the color-scheme media query and passes changes to the store. The effect removes its listener on unmount.

Theme-aware consumers that need a concrete light-or-dark value use `resolvedMode`. This includes CodeMirror, Shiki invalidation, and the toolbar icon and label. A preference change that resolves to the same appearance does not require a visual theme transition.

## Settings UI

`AppearanceControls` extends its existing single-select toggle group with a System item. The new interactive element uses `data-testid="settings-appearance-mode-system"`. Selecting it calls `setMode('system')`; it does not write general settings through the daemon API.

No new layout, dialog, dependency, or daemon setting is required.

## Testing

Focused UI tests cover:

- System as the default for missing and invalid storage values.
- Persistence of the System preference.
- Startup resolution for light and dark operating-system settings.
- Live operating-system changes while System is selected.
- Ignoring operating-system changes while Light or Dark is selected.
- Media-query listener cleanup.
- The Settings System control and its lack of a daemon `PUT`.
- Concrete-theme consumers using `resolvedMode`, including the toolbar's quick override.

Run the focused Vitest files and the UI TypeScript check. Existing Light, Dark, UI scale, and toolbar tests remain green.
