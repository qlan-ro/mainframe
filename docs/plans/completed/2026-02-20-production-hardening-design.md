# Production Hardening: Single Instance + DevTools Lockdown

**Date:** 2026-02-20
**Scope:** `packages/desktop/src/main/index.ts`

## Problem

The production Electron build has two gaps:

1. Multiple instances of the app can run simultaneously, leading to conflicting daemon connections and confusing state.
2. Developer Tools are accessible in production via the "Toggle Developer Tools" menu item (View → Toggle Developer Tools) and the ⌥⌘I keyboard shortcut, exposing internal app state to end users.

Additionally, DevTools auto-open on `ready-to-show` in development mode, which is noisy and not desirable as a default.

## Design

All changes are confined to `packages/desktop/src/main/index.ts`. No new files, no new dependencies. `Menu` and `MenuItem` are added to the existing `electron` import.

### 1. Single Instance Lock

Call `app.requestSingleInstanceLock()` before `app.whenReady()`. If the lock is not granted (another instance is already running), call `app.quit()` immediately.

Register a `second-instance` event handler that focuses and restores the existing window when a second launch is attempted.

```typescript
const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) app.quit();

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});
```

### 2. Remove DevTools Auto-Open in Dev

Remove the `openDevTools` call inside the `ready-to-show` handler. DevTools remain accessible manually in development via keyboard shortcut or menu — they just no longer open automatically.

### 3. Block DevTools in Production (two layers)

**Layer 1 — Remove menu item** (`setProductionMenu()`): Rebuild the application menu, filtering out the `toggledevtools` role item from the View submenu. This hides the option from the UI entirely.

```typescript
function setProductionMenu(): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const newItems = menu.items.map(topItem => {
    if (topItem.label !== 'View') return topItem;
    return new MenuItem({
      label: 'View',
      submenu: Menu.buildFromTemplate(
        topItem.submenu!.items.filter(sub => sub.role !== 'toggledevtools')
      ),
    });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(newItems));
}
```

Called from `app.whenReady()` when `NODE_ENV !== 'development'`.

**Layer 2 — `devtools-opened` listener** (defense in depth): Even if DevTools are triggered by the keyboard shortcut or any other path, they are immediately closed.

```typescript
// In createWindow(), only in production
mainWindow.webContents.on('devtools-opened', () => {
  mainWindow?.webContents.closeDevTools();
});
```

## What Does Not Change

- The remote debugging port (`--remote-debugging-port=9222`) is already gated to dev mode and is unchanged.
- Devtools remain fully accessible in development (keyboard shortcut and menu still work).
- The daemon startup guard (`NODE_ENV !== 'development'`) is unchanged.
