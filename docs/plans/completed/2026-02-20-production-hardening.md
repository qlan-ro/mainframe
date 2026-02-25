# Production Hardening: Single Instance + DevTools Lockdown

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent multiple app instances from running simultaneously and block access to Developer Tools in production builds.

**Architecture:** All changes are in the Electron main process entry point (`packages/desktop/src/main/index.ts`). Single instance enforcement uses Electron's built-in `app.requestSingleInstanceLock()` API. DevTools blocking uses two layers: removing the menu item from the View menu and a `devtools-opened` listener as defense in depth.

**Tech Stack:** Electron `app`, `Menu`, `MenuItem` APIs; TypeScript strict mode; Vitest for tests.

---

### Task 1: Single instance lock

**Files:**
- Modify: `packages/desktop/src/main/index.ts`

The app currently allows multiple instances. Electron provides `app.requestSingleInstanceLock()` which uses OS-level locking. If the lock isn't acquired, a second instance is already running and we should quit. If the lock is acquired, we register a `second-instance` handler to focus the existing window when another launch is attempted.

**Step 1: Add the instance lock before `app.whenReady()`**

In `packages/desktop/src/main/index.ts`, add this block immediately after the `NODE_ENV === 'development'` remote debugging port block (after line 16):

```typescript
// Enforce single instance. If the lock is not acquired, another instance is
// already running — quit immediately and let it handle the activation.
const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: builds with no TypeScript errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/main/index.ts
git commit -m "feat(desktop): enforce single app instance with focus-on-relaunch"
```

---

### Task 2: Remove DevTools auto-open in dev

**Files:**
- Modify: `packages/desktop/src/main/index.ts`

Currently the `ready-to-show` handler auto-opens DevTools when `NODE_ENV === 'development'`. This is noisy — dev tools should be opened manually when needed.

**Step 1: Remove the auto-open block**

In `packages/desktop/src/main/index.ts`, find the `ready-to-show` handler (around line 104) and remove the `if` block that calls `openDevTools`. The handler should become:

```typescript
mainWindow.on('ready-to-show', () => {
  mainWindow?.show();
});
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: builds with no TypeScript errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/main/index.ts
git commit -m "chore(desktop): remove devtools auto-open in dev mode"
```

---

### Task 3: Block DevTools in production

**Files:**
- Modify: `packages/desktop/src/main/index.ts`

Two-layer approach:
- **Layer 1** (`setProductionMenu`): Rebuild the application menu omitting the `toggledevtools` item from the View submenu. This hides the option visually.
- **Layer 2** (`devtools-opened` listener): Immediately close DevTools if they're somehow opened (e.g. via ⌥⌘I keyboard shortcut). Defense in depth.

**Step 1: Add `Menu` and `MenuItem` to the electron import**

Change line 1 from:
```typescript
import { app, BrowserWindow, shell, ipcMain, dialog, utilityProcess } from 'electron';
```
to:
```typescript
import { app, BrowserWindow, shell, ipcMain, dialog, utilityProcess, Menu, MenuItem } from 'electron';
```

**Step 2: Add `setProductionMenu()` function**

Add this function after the `startDaemon` function (before `setupIPC`):

```typescript
function setProductionMenu(): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;

  const newItems = menu.items.map((topItem) => {
    if (topItem.label !== 'View') return topItem;

    // Rebuild View submenu without the Toggle Developer Tools item.
    return new MenuItem({
      label: 'View',
      submenu: Menu.buildFromTemplate(
        topItem.submenu!.items.filter((sub) => sub.role !== 'toggledevtools'),
      ),
    });
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(newItems));
}
```

**Step 3: Call `setProductionMenu()` from `app.whenReady()`**

In the `app.whenReady().then(...)` block, add a production-only call to `setProductionMenu()` before `createWindow()`:

```typescript
app.whenReady().then(() => {
  log.info({ version: app.getVersion() }, 'app ready');
  setupIPC();
  startDaemon();

  if (process.env.NODE_ENV !== 'development') {
    setProductionMenu();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
```

**Step 4: Add `devtools-opened` listener in `createWindow()`**

Inside `createWindow()`, after the `setWindowOpenHandler` call, add:

```typescript
if (process.env.NODE_ENV !== 'development') {
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow?.webContents.closeDevTools();
  });
}
```

**Step 5: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: builds with no TypeScript errors.

**Step 6: Commit**

```bash
git add packages/desktop/src/main/index.ts
git commit -m "feat(desktop): block devtools access in production builds"
```

---

## Manual Verification

After all tasks:

1. **Single instance** — Build and run the app (`pnpm --filter @mainframe/desktop start`). Try launching a second instance from terminal. The second launch should exit and the first window should come to the foreground.

2. **No DevTools auto-open** — Run `pnpm --filter @mainframe/desktop dev`. Window should open without DevTools panel visible. Open DevTools manually via ⌥⌘I to confirm they still work in dev.

3. **Production DevTools blocked** — Run `pnpm --filter @mainframe/desktop start` (preview mode, `NODE_ENV=production`). Open View menu → "Toggle Developer Tools" should be absent. Press ⌥⌘I — DevTools should not open (or open and immediately close).
