# Check for Updates — Menu Item

## Problem

The app already runs scheduled update checks every 4 hours via `electron-updater` and surfaces `available`/`downloading`/`downloaded` states in the StatusBar. Users who want to check on demand have no way to trigger a check, and have no way to confirm they're already on the latest version. A manual entry point is needed.

## Solution

Add a **Check for Updates…** menu item under **Help**, on every platform. Wire it to the existing `update:check` IPC. Show a native dialog only when a manual check produces a "silent" outcome — `not-available` or persistent `error`. The StatusBar continues to own the `available` / `downloaded` flow.

## Scope

- One new menu item, in the Help submenu, on macOS, Windows, and Linux.
- Menu item is wired in production builds only (auto-updater is disabled in dev — match that).
- A "manual check" flag in the main process that scopes dialog feedback to user-initiated checks. Scheduled checks remain silent on `not-available` (unchanged).
- Native dialogs for the two cases the StatusBar currently doesn't handle:
  - `not-available` → "You're up to date." with current version.
  - `error` (persistent only — transient errors stay suppressed) → "Couldn't check for updates." with the error message.
- `available` and `downloaded` continue to flow through the existing StatusBar UI.

## Out of Scope

- No changes to scheduled check cadence or behavior.
- No changes to StatusBar.
- No "Updates" preferences pane, no opt-out, no channel selection.

## UX

### Menu placement

Help submenu, single item:

```
Help
  Check for Updates…
```

Trailing ellipsis is intentional — Apple HIG: the action may show further UI (the result dialog).

The item is disabled while a check is in flight (debounce against double-click and against overlap with scheduled checks).

### Dialog: up to date

- Title: `You're up to date`
- Message: `Mainframe ${app.getVersion()} is the latest version available.`
- Buttons: `OK` (default).

### Dialog: error

- Title: `Couldn't check for updates`
- Message: short user-facing summary
- Detail: `error.message` from the auto-updater
- Buttons: `OK` (default).

### Dialog: available

Not shown — StatusBar handles this. (The existing flow already shows the new version + a "Download" affordance in the StatusBar; a dialog would duplicate it and force a click.)

### Dialog: downloaded

Not shown — same reason.

## Architecture

### Components touched

1. `packages/desktop/src/main/auto-updater.ts`
   - Add an exported `checkForUpdatesManual()` function. Sets an internal `manualCheckInFlight` flag, calls `autoUpdater.checkForUpdates()`, returns the resulting promise.
   - In the existing event listeners, when `manualCheckInFlight` is true:
     - On `update-not-available` → show "up to date" dialog, clear flag.
     - On persistent `error` → show "couldn't check" dialog, clear flag.
     - On `update-available` → clear flag (StatusBar takes over).
     - On any terminal state, clear the flag.
   - Transient errors do **not** show a dialog (matches existing classifier behavior) but still clear the flag so the menu item re-enables.

2. `packages/desktop/src/main/index.ts`
   - New `buildApplicationMenu()` that constructs a full menu template (taking the default menu as a base and appending/replacing the Help submenu) and applies it via `Menu.setApplicationMenu`.
   - The Help submenu contains the **Check for Updates…** item, whose `click` handler calls `checkForUpdatesManual()` (imported from `auto-updater.ts`).
   - Replace `setProductionMenu()` call site with `buildApplicationMenu()`. Keep the existing devtools-stripping behavior for the View menu (production only).
   - In dev, the menu item is either omitted or disabled (auto-updater isn't initialized).

### Why a "manual" flag and not a separate IPC return value

`autoUpdater.checkForUpdates()` returns a promise that resolves to an `UpdateCheckResult` *only when an update is available*; it resolves to `null` when none is found, and rejects on error. We could in principle build manual UX off the promise alone — but the existing event-listener architecture already centralizes status handling, and threading manual-vs-scheduled through the existing listeners (one boolean flag) is simpler and keeps the dialog logic adjacent to the event taxonomy that drives it.

### State machine

```
idle ──menu click──▶ manual-check-in-flight
                         │
                         ├──not-available──▶ show "up to date" dialog ──▶ idle
                         ├──available─────▶ (StatusBar) ───────────────▶ idle
                         ├──persistent-error─▶ show error dialog ──────▶ idle
                         └──transient-error──▶ (silent) ───────────────▶ idle
```

Scheduled checks bypass this flag; their behavior is unchanged.

## Testing

- Unit test `auto-updater.ts`:
  - Manual check + `update-not-available` event → dialog shown.
  - Manual check + persistent error → dialog shown.
  - Manual check + transient error → dialog NOT shown, flag cleared.
  - Manual check + `update-available` → dialog NOT shown, flag cleared.
  - Scheduled check + `update-not-available` → dialog NOT shown.
  - Concurrent manual clicks while in flight → second is no-op (or menu item is disabled).
- Mock `electron`'s `dialog.showMessageBox` and `BrowserWindow`.

## Risks

- **Default menu replacement**: `Menu.getApplicationMenu()` returns the platform default; rebuilding it explicitly via `buildFromTemplate` carries some risk of dropping native items. Mitigation: take the existing menu's items and only mutate the Help and View submenus; don't reconstruct the App, Edit, or Window menus from scratch.
- **Dev mode mismatch**: in dev the auto-updater is a no-op. The menu item must either be omitted or disabled in dev to avoid a click that does nothing. Decision: disable in dev.
