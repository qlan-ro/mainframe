# Check for Updates Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Check for Updates…" item to the Help menu on every platform that triggers a manual update check and shows a native dialog when there's no update or a persistent error.

**Architecture:** Extend `auto-updater.ts` with a `checkForUpdatesManual()` entry point that sets a `manualCheckInFlight` flag. The existing event listeners gain dialog-emitting branches that fire only when the flag is set. A new `buildApplicationMenu()` in `index.ts` mutates the default menu's Help submenu to include the new item; existing View menu mutation (strip devtools in production) is preserved.

**Tech Stack:** Electron, electron-updater, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-05-07-check-for-updates-menu-design.md`

---

## File Structure

- **Modify** `packages/desktop/src/main/auto-updater.ts` — add manual flag, dialog calls, exported `checkForUpdatesManual()` and `isManualCheckInFlight()`.
- **Modify** `packages/desktop/src/main/index.ts` — replace `setProductionMenu()` with `buildApplicationMenu()` that injects the Help item.
- **Create** `packages/desktop/src/main/auto-updater.test.ts` — unit tests for manual-check dialog behavior.
- **Create** `.changeset/check-for-updates-menu.md` — changeset entry.

---

## Task 1: Extend auto-updater with manual check + dialog feedback

**Files:**
- Modify: `packages/desktop/src/main/auto-updater.ts`
- Create: `packages/desktop/src/main/auto-updater.test.ts`

### Step 1: Write the failing tests

- [ ] Create `packages/desktop/src/main/auto-updater.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron-updater's autoUpdater as an EventEmitter-like object we control.
const listeners = new Map<string, ((arg?: unknown) => void)[]>();
const mockAutoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on: vi.fn((event: string, fn: (arg?: unknown) => void) => {
    const arr = listeners.get(event) ?? [];
    arr.push(fn);
    listeners.set(event, arr);
  }),
  checkForUpdates: vi.fn().mockResolvedValue(null),
  downloadUpdate: vi.fn().mockResolvedValue(undefined),
  quitAndInstall: vi.fn(),
};
vi.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }));

const showMessageBox = vi.fn().mockResolvedValue({ response: 0 });
const ipcHandle = vi.fn();
const mockWindow = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
} as unknown as import('electron').BrowserWindow;

vi.mock('electron', () => ({
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
  ipcMain: { handle: (...args: unknown[]) => ipcHandle(...args) },
  app: { getVersion: () => '0.17.2' },
  BrowserWindow: class {},
}));

vi.mock('./logger.js', () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function emit(event: string, arg?: unknown): void {
  for (const fn of listeners.get(event) ?? []) fn(arg);
}

beforeEach(() => {
  listeners.clear();
  showMessageBox.mockClear();
  mockAutoUpdater.checkForUpdates.mockClear();
  vi.resetModules();
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  delete process.env.NODE_ENV;
});

describe('auto-updater manual check', () => {
  it('shows "up to date" dialog on update-not-available when manual', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    emit('update-not-available');
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0]![1].message).toMatch(/up to date/i);
  });

  it('does NOT show dialog on update-not-available when scheduled', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    emit('update-not-available');
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('shows error dialog on persistent error when manual', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    emit('error', Object.assign(new Error('signature mismatch'), { code: 'EPERM' }));
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0]![1].title).toMatch(/couldn't check/i);
  });

  it('does NOT show dialog on transient error when manual, but clears in-flight flag', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    emit('error', Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(mod.isManualCheckInFlight()).toBe(false);
  });

  it('does NOT show dialog on update-available when manual (StatusBar handles it)', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    emit('update-available', { version: '0.18.0' });
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(mod.isManualCheckInFlight()).toBe(false);
  });

  it('checkForUpdatesManual is a no-op when already in-flight', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('checkForUpdatesManual is a no-op in development mode', async () => {
    process.env.NODE_ENV = 'development';
    const mod = await import('./auto-updater.js');
    await mod.checkForUpdatesManual(mockWindow);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});
```

### Step 2: Run tests to verify they fail

- [ ] Run: `pnpm --filter @qlan-ro/mainframe-desktop test src/main/auto-updater.test.ts`
- [ ] Expected: tests fail (function `checkForUpdatesManual` / `isManualCheckInFlight` not exported).

### Step 3: Implement changes in auto-updater.ts

- [ ] Replace the file contents with:

```ts
import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain, dialog, app } from 'electron';
import { createMainLogger } from './logger.js';
import { classifyUpdateError } from './auto-updater-error-classifier.js';

const log = createMainLogger('electron:auto-updater');

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let manualCheckInFlight = false;
let manualCheckWindow: BrowserWindow | null = null;

export function isManualCheckInFlight(): boolean {
  return manualCheckInFlight;
}

function clearManualFlag(): void {
  manualCheckInFlight = false;
  manualCheckWindow = null;
}

function showUpToDateDialog(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  void dialog.showMessageBox(window, {
    type: 'info',
    title: "You're up to date",
    message: `Mainframe ${app.getVersion()} is the latest version available.`,
    buttons: ['OK'],
    defaultId: 0,
  });
}

function showErrorDialog(window: BrowserWindow, message: string): void {
  if (window.isDestroyed()) return;
  void dialog.showMessageBox(window, {
    type: 'error',
    title: "Couldn't check for updates",
    message: 'Mainframe was unable to check for updates.',
    detail: message,
    buttons: ['OK'],
    defaultId: 0,
  });
}

function send(mainWindow: BrowserWindow, status: UpdateStatus): void {
  if (mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update-status', status);
}

function registerListeners(mainWindow: BrowserWindow): void {
  autoUpdater.on('checking-for-update', () => {
    log.info('checking for update');
    send(mainWindow, { state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info({ version: info.version }, 'update available');
    send(mainWindow, { state: 'available', version: info.version });
    if (manualCheckInFlight) clearManualFlag();
  });

  autoUpdater.on('update-not-available', () => {
    log.info('no update available');
    send(mainWindow, { state: 'not-available' });
    if (manualCheckInFlight) {
      const target = manualCheckWindow ?? mainWindow;
      clearManualFlag();
      showUpToDateDialog(target);
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    send(mainWindow, { state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info({ version: info.version }, 'update downloaded');
    send(mainWindow, { state: 'downloaded', version: info.version });
    if (manualCheckInFlight) clearManualFlag();
  });

  autoUpdater.on('error', (err) => {
    const kind = classifyUpdateError(err);
    if (kind === 'transient') {
      log.warn({ message: err.message, kind }, 'transient update check error (suppressed from UI)');
      if (manualCheckInFlight) clearManualFlag();
      return;
    }
    log.error({ message: err.message, kind }, 'persistent update error');
    send(mainWindow, { state: 'error', message: err.message });
    if (manualCheckInFlight) {
      const target = manualCheckWindow ?? mainWindow;
      clearManualFlag();
      showErrorDialog(target, err.message);
    }
  });
}

function registerIPC(): void {
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
}

function scheduleChecks(): void {
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      log.warn({ err }, 'scheduled update check failed');
    });
  }, 10_000);

  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        log.warn({ err }, 'periodic update check failed');
      });
    },
    4 * 60 * 60 * 1_000,
  );
}

export async function checkForUpdatesManual(window: BrowserWindow): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    log.info('development mode: manual update check skipped');
    return;
  }
  if (manualCheckInFlight) {
    log.info('manual update check already in flight; ignoring duplicate request');
    return;
  }
  manualCheckInFlight = true;
  manualCheckWindow = window;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err: unknown) {
    // The 'error' event listener above handles the user-facing dialog.
    log.warn({ err }, 'manual update check threw');
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (process.env.NODE_ENV === 'development') {
    log.info('development mode: auto-updater disabled');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  registerListeners(mainWindow);
  registerIPC();
  scheduleChecks();

  log.info('auto-updater initialized');
}
```

### Step 4: Run tests to verify they pass

- [ ] Run: `pnpm --filter @qlan-ro/mainframe-desktop test src/main/auto-updater.test.ts`
- [ ] Expected: all 7 tests pass.

### Step 5: Typecheck

- [ ] Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
- [ ] Expected: build completes without TypeScript errors.

### Step 6: Commit

- [ ] Run:

```bash
git add packages/desktop/src/main/auto-updater.ts packages/desktop/src/main/auto-updater.test.ts
git commit -m "feat(desktop): manual update check with dialog feedback"
```

---

## Task 2: Add Help → Check for Updates… menu item

**Files:**
- Modify: `packages/desktop/src/main/index.ts` (lines 103–119, 267–269)

### Step 1: Replace `setProductionMenu` with `buildApplicationMenu`

- [ ] In `packages/desktop/src/main/index.ts`, change the import on line 16 from:

```ts
import { initAutoUpdater } from './auto-updater.js';
```

to:

```ts
import { initAutoUpdater, checkForUpdatesManual } from './auto-updater.js';
```

- [ ] Replace the `setProductionMenu` function (lines 103–119) with:

```ts
function buildApplicationMenu(): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    log.warn('buildApplicationMenu: no application menu found');
    return;
  }

  const isProduction = process.env.NODE_ENV !== 'development';

  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    enabled: isProduction,
    click: () => {
      if (mainWindow) checkForUpdatesManual(mainWindow);
    },
  };

  const newItems: Electron.MenuItemConstructorOptions[] = menu.items.map((topItem) => {
    if (topItem.label === 'View' && topItem.submenu && isProduction) {
      return {
        label: 'View',
        submenu: topItem.submenu.items
          .filter((sub) => sub.role !== 'toggledevtools')
          .map((sub) => ({ role: sub.role, label: sub.label, accelerator: sub.accelerator })),
      };
    }
    if (topItem.role === 'help' && topItem.submenu) {
      const helpSubmenu = topItem.submenu.items.map((sub) => ({
        role: sub.role,
        label: sub.label,
        accelerator: sub.accelerator,
      }));
      return {
        label: topItem.label || 'Help',
        role: 'help',
        submenu: [checkForUpdatesItem, { type: 'separator' }, ...helpSubmenu],
      };
    }
    return topItem;
  });

  // If the default menu has no Help submenu (e.g. some Linux distros),
  // append one ourselves so the item is always reachable.
  const hasHelp = newItems.some((item) => item.role === 'help' || item.label === 'Help');
  if (!hasHelp) {
    newItems.push({ label: 'Help', role: 'help', submenu: [checkForUpdatesItem] });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(newItems));
}
```

- [ ] Replace the call site (lines 267–269):

```ts
if (process.env.NODE_ENV !== 'development') {
  setProductionMenu();
}
```

with:

```ts
buildApplicationMenu();
```

### Step 2: Manual verification (production-like build)

- [ ] Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
- [ ] Expected: build succeeds.
- [ ] Optional dev verification: `pnpm dev` and confirm "Check for Updates…" appears in Help menu but is greyed out (NODE_ENV=development).
- [ ] Production verification (only if a packaged build is available): launch a packaged build, click Help → Check for Updates… and confirm the dialog appears.

### Step 3: Commit

- [ ] Run:

```bash
git add packages/desktop/src/main/index.ts
git commit -m "feat(desktop): add Help → Check for Updates… menu item"
```

---

## Task 3: Add changeset

**Files:**
- Create: `.changeset/check-for-updates-menu.md`

### Step 1: Create changeset

- [ ] Create `.changeset/check-for-updates-menu.md`:

```md
---
'@qlan-ro/mainframe-desktop': patch
---

Add a "Check for Updates…" item to the Help menu. Triggers a manual update check and shows a native dialog when you're already on the latest version or when the check fails. Available updates continue to surface in the status bar as before.
```

### Step 2: Commit

- [ ] Run:

```bash
git add .changeset/check-for-updates-menu.md
git commit -m "chore: changeset for check-for-updates menu item"
```

---

## Final Verification

- [ ] Run from repo root: `pnpm --filter @qlan-ro/mainframe-desktop test`
- [ ] Expected: all desktop tests pass, including the 7 new auto-updater tests.
- [ ] Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
- [ ] Expected: build completes without errors.
- [ ] Run: `git log --oneline main..HEAD`
- [ ] Expected: 3 new commits — feat (auto-updater), feat (menu), chore (changeset) — plus the spec commit from earlier.
