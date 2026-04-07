# Integrated Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop-only terminal panel (node-pty + xterm.js) to the bottom panel, toggled from the LeftRail as a separate mode from the preview panel.

**Architecture:** PTY shells are spawned and managed in the Electron main process (`terminal-manager.ts`). Data flows over IPC channels to the renderer, where xterm.js renders each terminal instance. A Zustand store tracks terminal tabs. The UIStore gains a `bottomPanelMode` field to switch between preview and terminal views.

**Tech Stack:** node-pty, xterm, @xterm/addon-fit, Electron IPC, Zustand, React

**Spec:** `docs/superpowers/specs/2026-04-06-integrated-terminal-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/main/terminal-manager.ts` | PTY lifecycle (spawn/write/resize/kill), IPC handler registration, cleanup |
| `src/renderer/store/terminal.ts` | Zustand store for terminal tab state (tabs list, active tab) |
| `src/renderer/components/terminal/TerminalPanel.tsx` | Tab bar + terminal switching + new/close/minimize actions |
| `src/renderer/components/terminal/TerminalInstance.tsx` | Single xterm.js instance, wired to PTY via IPC |

### Modified Files

| File | Change |
|------|--------|
| `electron.vite.config.ts` | Add `'node-pty'` to main process rollup externals |
| `package.json` | Add `node-pty`, `@xterm/xterm`, `@xterm/addon-fit` dependencies |
| `src/preload/index.ts` | Add `terminal` namespace to `MainframeAPI` |
| `src/renderer/types/global.d.ts` | Add `terminal` types to `MainframeAPI` interface |
| `src/renderer/store/ui.ts` | Add `bottomPanelMode` field and `setBottomPanelMode` action |
| `src/renderer/store/index.ts` | Re-export `useTerminalStore` |
| `src/main/index.ts` | Call `setupTerminalIPC()`, add PTY cleanup to quit handler |
| `src/renderer/components/LeftRail.tsx` | Add terminal toggle button |
| `src/renderer/components/sandbox/BottomPanel.tsx` | Switch between PreviewTab and TerminalPanel based on mode |

---

## Task 1: Install Dependencies & Configure Build

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/electron.vite.config.ts`

- [ ] **Step 1: Install node-pty, xterm, and addon-fit**

```bash
cd packages/desktop
pnpm add node-pty
pnpm add @xterm/xterm @xterm/addon-fit
```

`node-pty` is a main-process dependency (native). `@xterm/xterm` and `@xterm/addon-fit` are renderer dependencies (pure JS).

- [ ] **Step 2: Add node-pty to electron-vite externals**

In `packages/desktop/electron.vite.config.ts`, change the main process external:

```ts
// Before:
external: ['electron'],

// After:
external: ['electron', 'node-pty'],
```

This prevents Rollup from bundling the native `.node` addon into the main process bundle.

- [ ] **Step 3: Add node-pty to electron-builder extraResources**

In `packages/desktop/package.json`, add to the `build.extraResources` array:

```json
{
  "from": "../../node_modules/node-pty",
  "to": "node_modules/node-pty",
  "filter": ["**/*", "!**/*.md"]
}
```

This ensures the native module is packaged in production builds.

- [ ] **Step 4: Verify install succeeded**

Run: `pnpm build --filter @qlan-ro/mainframe-desktop 2>&1 | tail -5`

Expected: Build completes without errors. (node-pty may emit native compilation warnings — that's fine as long as the build succeeds.)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/electron.vite.config.ts pnpm-lock.yaml
git commit -m "feat(desktop): add node-pty and xterm dependencies for integrated terminal"
```

---

## Task 2: Terminal Manager (Main Process)

**Files:**
- Create: `packages/desktop/src/main/terminal-manager.ts`
- Modify: `packages/desktop/src/main/index.ts`

- [ ] **Step 1: Create the terminal manager module**

Create `packages/desktop/src/main/terminal-manager.ts`:

```ts
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'crypto';
import pty from 'node-pty';
import type { IPty } from 'node-pty';
import { createMainLogger } from './logger.js';

const log = createMainLogger('terminal');

interface ManagedTerminal {
  pty: IPty;
  /** webContents.id that owns this terminal — used to route data events */
  webContentsId: number;
}

const terminals = new Map<string, ManagedTerminal>();

export function setupTerminalIPC(shellEnv: Record<string, string>): void {
  const defaultShell = process.platform === 'win32'
    ? 'powershell.exe'
    : (shellEnv['SHELL'] || process.env.SHELL || '/bin/zsh');

  ipcMain.handle('terminal:create', (event: IpcMainInvokeEvent, options: { cwd: string }) => {
    const id = randomUUID();
    const cols = 80;
    const rows = 24;

    const term = pty.spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: options.cwd,
      env: { ...shellEnv, TERM_PROGRAM: 'Mainframe' },
    });

    const webContentsId = event.sender.id;
    terminals.set(id, { pty: term, webContentsId });

    term.onData((data: string) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('terminal:data', id, data);
        }
      } catch {
        /* webContents destroyed — terminal will be cleaned up on quit */
      }
    });

    term.onExit(({ exitCode }) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('terminal:exit', id, exitCode);
        }
      } catch {
        /* webContents destroyed */
      }
      terminals.delete(id);
    });

    log.info({ id, cwd: options.cwd, shell: defaultShell }, 'terminal created');
    return { id };
  });

  ipcMain.handle('terminal:write', (_event: IpcMainInvokeEvent, id: string, data: string) => {
    const entry = terminals.get(id);
    if (!entry) return;
    entry.pty.write(data);
  });

  ipcMain.handle('terminal:resize', (_event: IpcMainInvokeEvent, id: string, cols: number, rows: number) => {
    const entry = terminals.get(id);
    if (!entry) return;
    try {
      entry.pty.resize(cols, rows);
    } catch {
      /* resize can throw if process already exited */
    }
  });

  ipcMain.handle('terminal:kill', (_event: IpcMainInvokeEvent, id: string) => {
    const entry = terminals.get(id);
    if (!entry) return;
    try {
      entry.pty.kill();
    } catch {
      /* already dead */
    }
    terminals.delete(id);
    log.info({ id }, 'terminal killed');
  });
}

export function killAllTerminals(): void {
  for (const [id, entry] of terminals) {
    try {
      entry.pty.kill();
    } catch {
      /* already dead */
    }
    terminals.delete(id);
  }
  log.info({ count: terminals.size }, 'all terminals killed');
}
```

- [ ] **Step 2: Wire terminal manager into the main process**

In `packages/desktop/src/main/index.ts`, add the import at the top alongside other imports:

```ts
import { setupTerminalIPC, killAllTerminals } from './terminal-manager.js';
```

In the `app.whenReady().then(...)` callback, after `setupIPC()` and `startDaemon()`, add:

```ts
setupTerminalIPC(resolveShellEnv());
```

Note: `resolveShellEnv()` is currently called inside `startDaemon()`. Refactor it to call once and share:

```ts
// Replace the existing lines:
//   setupIPC();
//   startDaemon();
// With:
const shellEnv = resolveShellEnv();
setupIPC();
startDaemon(shellEnv);
setupTerminalIPC(shellEnv);
```

Update the `startDaemon` function signature to accept the env:

```ts
function startDaemon(shellEnv: Record<string, string>): void {
  if (process.env.NODE_ENV === 'development') {
    log.info('development mode: daemon assumed external');
    return;
  }
  const daemonPath = process.env['MAINFRAME_DAEMON_PATH'] ?? join(process.resourcesPath, 'daemon.cjs');
  log.info({ path: daemonPath }, 'daemon starting');
  daemon = utilityProcess.fork(daemonPath, [], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', ...shellEnv },
  });
  daemon.on('exit', (code) => {
    log.error({ code }, 'daemon exited');
  });
}
```

In the `app.on('quit')` handler, add terminal cleanup:

```ts
app.on('quit', () => {
  killAllTerminals();
  if (daemon) {
    daemon.kill();
  }
});
```

- [ ] **Step 3: Verify the main process builds**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build 2>&1 | tail -5`

Expected: Build succeeds. node-pty is externalized (not bundled).

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/terminal-manager.ts packages/desktop/src/main/index.ts
git commit -m "feat(desktop): add terminal manager with PTY lifecycle and IPC handlers"
```

---

## Task 3: Preload & Type Declarations

**Files:**
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/renderer/types/global.d.ts`

- [ ] **Step 1: Add terminal namespace to preload API**

In `packages/desktop/src/preload/index.ts`, add a `TerminalAPI` interface and the implementation.

Add the interface above the existing `MainframeAPI` interface:

```ts
export interface TerminalAPI {
  create: (options: { cwd: string }) => Promise<{ id: string }>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  onData: (callback: (id: string, data: string) => void) => void;
  onExit: (callback: (id: string, exitCode: number) => void) => void;
  removeDataListener: () => void;
  removeExitListener: () => void;
}
```

Add `terminal: TerminalAPI` to the `MainframeAPI` interface:

```ts
export interface MainframeAPI {
  // ... existing fields ...
  terminal: TerminalAPI;
}
```

Add the implementation inside the `api` object, before the closing brace:

```ts
terminal: {
  create: (options: { cwd: string }) => ipcRenderer.invoke('terminal:create', options),
  write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
  onData: (callback: (id: string, data: string) => void) => {
    ipcRenderer.on('terminal:data', (_event, id: string, data: string) => callback(id, data));
  },
  onExit: (callback: (id: string, exitCode: number) => void) => {
    ipcRenderer.on('terminal:exit', (_event, id: string, exitCode: number) => callback(id, exitCode));
  },
  removeDataListener: () => {
    ipcRenderer.removeAllListeners('terminal:data');
  },
  removeExitListener: () => {
    ipcRenderer.removeAllListeners('terminal:exit');
  },
},
```

- [ ] **Step 2: Update global type declarations**

In `packages/desktop/src/renderer/types/global.d.ts`, add the `TerminalAPI` interface and update `MainframeAPI`:

```ts
export interface TerminalAPI {
  create: (options: { cwd: string }) => Promise<{ id: string }>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  onData: (callback: (id: string, data: string) => void) => void;
  onExit: (callback: (id: string, exitCode: number) => void) => void;
  removeDataListener: () => void;
  removeExitListener: () => void;
}

export interface MainframeAPI {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  getAppInfo: () => Promise<{ version: string; author: string }>;
  readFile: (filePath: string) => Promise<string | null>;
  showItemInFolder: (fullPath: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  clearSandboxSession: (projectId: string) => Promise<void>;
  showNotification: (title: string, body?: string) => Promise<void>;
  log: (level: string, module: string, message: string, data?: unknown) => void;
  terminal: TerminalAPI;
}

declare global {
  interface Window {
    mainframe: MainframeAPI;
  }
}
```

- [ ] **Step 3: Verify the build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build 2>&1 | tail -5`

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/preload/index.ts packages/desktop/src/renderer/types/global.d.ts
git commit -m "feat(desktop): expose terminal IPC channels in preload and type declarations"
```

---

## Task 4: UIStore — Bottom Panel Mode

**Files:**
- Modify: `packages/desktop/src/renderer/store/ui.ts`

- [ ] **Step 1: Add bottomPanelMode to UIStore**

In `packages/desktop/src/renderer/store/ui.ts`, add the new field and action.

Add to the `UIState` interface:

```ts
bottomPanelMode: 'preview' | 'terminal';
setBottomPanelMode: (mode: UIState['bottomPanelMode']) => void;
```

Add to the store initial state (inside the `persist` callback):

```ts
bottomPanelMode: 'preview',
```

Add the action:

```ts
setBottomPanelMode: (mode) => set({ bottomPanelMode: mode }),
```

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/store/ui.ts
git commit -m "feat(desktop): add bottomPanelMode to UIStore for terminal/preview switching"
```

---

## Task 5: Terminal Store

**Files:**
- Create: `packages/desktop/src/renderer/store/terminal.ts`
- Modify: `packages/desktop/src/renderer/store/index.ts`

- [ ] **Step 1: Create the terminal store**

Create `packages/desktop/src/renderer/store/terminal.ts`:

```ts
import { create } from 'zustand';

export interface TerminalTab {
  id: string;
  name: string;
}

interface TerminalState {
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  addTerminal: (tab: TerminalTab) => void;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string | null) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  terminals: [],
  activeTerminalId: null,

  addTerminal: (tab) =>
    set((state) => ({
      terminals: [...state.terminals, tab],
      activeTerminalId: tab.id,
    })),

  removeTerminal: (id) =>
    set((state) => {
      const next = state.terminals.filter((t) => t.id !== id);
      const activeGone = state.activeTerminalId === id;
      return {
        terminals: next,
        activeTerminalId: activeGone ? (next[next.length - 1]?.id ?? null) : state.activeTerminalId,
      };
    }),

  setActiveTerminal: (id) => set({ activeTerminalId: id }),
}));
```

- [ ] **Step 2: Export from store barrel**

In `packages/desktop/src/renderer/store/index.ts`, add:

```ts
export { useTerminalStore } from './terminal';
export type { TerminalTab } from './terminal';
```

- [ ] **Step 3: Verify the build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/store/terminal.ts packages/desktop/src/renderer/store/index.ts
git commit -m "feat(desktop): add terminal tab Zustand store"
```

---

## Task 6: TerminalInstance Component

**Files:**
- Create: `packages/desktop/src/renderer/components/terminal/TerminalInstance.tsx`

- [ ] **Step 1: Create the TerminalInstance component**

Create `packages/desktop/src/renderer/components/terminal/TerminalInstance.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalInstanceProps {
  terminalId: string;
  visible: boolean;
}

export function TerminalInstance({ terminalId, visible }: TerminalInstanceProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      theme: {
        background: getComputedStyle(document.documentElement)
          .getPropertyValue('--mf-input-bg').trim() || '#1e1e2e',
        foreground: getComputedStyle(document.documentElement)
          .getPropertyValue('--mf-text-primary').trim() || '#cdd6f4',
        cursor: getComputedStyle(document.documentElement)
          .getPropertyValue('--mf-accent').trim() || '#fab387',
        selectionBackground: '#585b7066',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Wire keystrokes → PTY
    const onDataDisposable = term.onData((data) => {
      window.mainframe.terminal.write(terminalId, data);
    });

    // Wire PTY output → xterm
    const handleData = (id: string, data: string): void => {
      if (id === terminalId) {
        term.write(data);
      }
    };
    window.mainframe.terminal.onData(handleData);

    // Handle resize
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      window.mainframe.terminal.resize(terminalId, cols, rows);
    });

    // ResizeObserver for auto-fit
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          /* container not visible */
        }
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId]);

  // Re-fit when visibility changes (tab switch)
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      // Delay fit to next frame so the DOM has the correct dimensions
      const frame = requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          /* not ready */
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: visible ? 'block' : 'none' }}
    />
  );
}
```

**Important note about IPC listeners:** Each `TerminalInstance` calls `window.mainframe.terminal.onData(handleData)` which adds a listener via `ipcRenderer.on`. The callback filters by `terminalId`, so each instance only processes its own data. The `TerminalPanel` parent handles `removeDataListener`/`removeExitListener` on unmount (Task 7).

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/terminal/TerminalInstance.tsx
git commit -m "feat(desktop): add TerminalInstance xterm.js component"
```

---

## Task 7: TerminalPanel Component

**Files:**
- Create: `packages/desktop/src/renderer/components/terminal/TerminalPanel.tsx`

- [ ] **Step 1: Create the TerminalPanel component**

Create `packages/desktop/src/renderer/components/terminal/TerminalPanel.tsx`:

```tsx
import React, { useCallback, useEffect, useRef } from 'react';
import { Plus, X, Minus } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useTerminalStore } from '../../store/terminal';
import { useProjectsStore, useUIStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { TerminalInstance } from './TerminalInstance';

export function TerminalPanel(): React.ReactElement {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);

  const activeProjectId = useActiveProjectId();
  const shellNameRef = useRef('zsh');
  const counterRef = useRef(0);

  const getCwd = useCallback((): string => {
    if (!activeProjectId) return process.env.HOME ?? '/';
    const chat = useChatsStore.getState().chats.find(
      (c) => c.id === useChatsStore.getState().activeChatId,
    );
    const project = useProjectsStore.getState().projects.find(
      (p) => p.id === activeProjectId,
    );
    if (!project) return process.env.HOME ?? '/';
    return chat?.worktreePath ?? project.path;
  }, [activeProjectId]);

  const createTerminal = useCallback(async () => {
    const cwd = getCwd();
    try {
      const { id } = await window.mainframe.terminal.create({ cwd });
      counterRef.current += 1;
      const name = counterRef.current === 1
        ? shellNameRef.current
        : `${shellNameRef.current} (${counterRef.current})`;
      addTerminal({ id, name });
    } catch (err) {
      console.warn('[terminal] failed to create terminal', err);
    }
  }, [getCwd, addTerminal]);

  const closeTerminal = useCallback(
    (id: string) => {
      window.mainframe.terminal.kill(id).catch(() => {});
      removeTerminal(id);
    },
    [removeTerminal],
  );

  // Auto-create first terminal on mount if none exist
  const didAutoCreate = useRef(false);
  useEffect(() => {
    if (terminals.length === 0 && !didAutoCreate.current) {
      didAutoCreate.current = true;
      void createTerminal();
    }
  }, [terminals.length, createTerminal]);

  // Handle terminal exit events
  useEffect(() => {
    const handleExit = (id: string, _exitCode: number): void => {
      // Keep the tab — TerminalInstance will show the exit status.
      // The PTY is already gone; just log for debugging.
      console.warn('[terminal] process exited', { id, _exitCode });
    };
    window.mainframe.terminal.onExit(handleExit);
    return () => {
      window.mainframe.terminal.removeExitListener();
    };
  }, []);

  // Cleanup all IPC listeners on unmount
  useEffect(() => {
    return () => {
      window.mainframe.terminal.removeDataListener();
      window.mainframe.terminal.removeExitListener();
    };
  }, []);

  // Detect shell name from platform
  useEffect(() => {
    if (window.mainframe.platform === 'win32') {
      shellNameRef.current = 'powershell';
    } else {
      shellNameRef.current = 'zsh';
    }
  }, []);

  return (
    <div className="h-full flex flex-col" data-testid="terminal-panel">
      {/* Tab bar */}
      <div className="flex items-center justify-between shrink-0 border-b border-mf-divider">
        <div className="flex items-center h-9 px-2 gap-0.5 overflow-x-auto">
          {terminals.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTerminal(t.id)}
              className={[
                'flex items-center gap-1.5 px-2.5 h-7 rounded text-mf-small transition-colors shrink-0',
                t.id === activeTerminalId
                  ? 'bg-mf-input-bg text-mf-text-primary'
                  : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover',
              ].join(' ')}
            >
              <span>{t.name}</span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(t.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-mf-destructive transition-opacity p-0.5"
                onMouseEnter={(e) =>
                  (e.currentTarget.parentElement!.style.cssText = '')
                }
              >
                <X size={12} />
              </span>
            </button>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void createTerminal()}
                className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
              >
                <Plus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New terminal</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center pr-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setPanelVisible(false)}
                aria-label="Minimize"
                className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
              >
                <Minus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Minimize</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Terminal instances — all mounted, only active one visible */}
      <div className="flex-1 min-h-0">
        {terminals.map((t) => (
          <TerminalInstance
            key={t.id}
            terminalId={t.id}
            visible={t.id === activeTerminalId}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/terminal/TerminalPanel.tsx
git commit -m "feat(desktop): add TerminalPanel with tab management"
```

---

## Task 8: Wire BottomPanel to Switch Modes

**Files:**
- Modify: `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`

- [ ] **Step 1: Add lazy-loaded TerminalPanel and mode switching**

In `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`:

Add the lazy import at the top of the file:

```tsx
import React, { Suspense, useCallback, useRef } from 'react';
import { useUIStore } from '../../store/ui';
import { PreviewTab } from './PreviewTab';

const TerminalPanel = React.lazy(() =>
  import('../terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
);
```

In the component body, read the mode:

```tsx
const bottomPanelMode = useUIStore((s) => s.bottomPanelMode);
```

Replace the `<PreviewTab />` render in the panel content area with:

```tsx
{bottomPanelMode === 'terminal' ? (
  <Suspense fallback={<div className="flex-1 flex items-center justify-center text-mf-text-secondary text-sm">Loading terminal...</div>}>
    <TerminalPanel />
  </Suspense>
) : (
  <PreviewTab />
)}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx
git commit -m "feat(desktop): switch BottomPanel between preview and terminal modes"
```

---

## Task 9: LeftRail Terminal Toggle Button

**Files:**
- Modify: `packages/desktop/src/renderer/components/LeftRail.tsx`

- [ ] **Step 1: Add the terminal toggle button**

In `packages/desktop/src/renderer/components/LeftRail.tsx`:

Add the import for the `TerminalSquare` icon:

```tsx
import { Settings, HelpCircle, MessageSquare, Play, TerminalSquare } from 'lucide-react';
```

Read the new store fields in the component body:

```tsx
const bottomPanelMode = useUIStore((s) => s.bottomPanelMode);
const setBottomPanelMode = useUIStore((s) => s.setBottomPanelMode);
```

Add the terminal button right after the existing logs toggle button (the `<Play>` RailButton), before the `<div className="w-5 h-px bg-mf-divider mx-auto" />` divider:

```tsx
<RailButton
  active={panelVisible && bottomPanelMode === 'terminal' && !activeFullviewId}
  onClick={() => {
    if (activeFullviewId) {
      usePluginLayoutStore.getState().activateFullview(activeFullviewId);
    }
    const isTerminalActive = panelVisible && bottomPanelMode === 'terminal';
    if (isTerminalActive) {
      // Toggle off
      setPanelVisible(false);
      return;
    }
    // Switch to terminal mode and show
    setBottomPanelMode('terminal');
    setPanelVisible(true);
    if (useUIStore.getState().panelCollapsed.bottom) {
      togglePanel('bottom');
    }
  }}
  title="Toggle terminal"
>
  <TerminalSquare size={16} />
</RailButton>
```

Update the existing logs/preview toggle button to set the mode to `'preview'`:

In the existing Play button's `onClick`, add `setBottomPanelMode('preview')` before `setPanelVisible(next)`:

```tsx
onClick={() => {
  if (activeFullviewId) {
    usePluginLayoutStore.getState().activateFullview(activeFullviewId);
    setBottomPanelMode('preview');
    setPanelVisible(true);
    if (useUIStore.getState().panelCollapsed.bottom) {
      togglePanel('bottom');
    }
    return;
  }
  const isPreviewActive = panelVisible && bottomPanelMode === 'preview';
  if (isPreviewActive) {
    setPanelVisible(false);
    return;
  }
  setBottomPanelMode('preview');
  setPanelVisible(true);
  if (useUIStore.getState().panelCollapsed.bottom) {
    togglePanel('bottom');
  }
}}
```

Update the Play button's `active` prop:

```tsx
active={panelVisible && bottomPanelMode === 'preview' && !activeFullviewId}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/LeftRail.tsx
git commit -m "feat(desktop): add terminal toggle button to LeftRail"
```

---

## Task 10: Manual Testing & Polish

- [ ] **Step 1: Start the dev environment**

```bash
pnpm dev:core &
pnpm --filter @qlan-ro/mainframe-desktop dev
```

- [ ] **Step 2: Test the terminal panel**

Verify:
1. Click the terminal icon in the LeftRail — bottom panel opens with a terminal
2. Terminal shows a working shell (type `ls`, `pwd`, expect correct output)
3. Working directory is the active project root
4. Click "+" to create a second terminal tab
5. Switch between tabs — both terminals retain their state
6. Click "x" to close a tab — terminal process is killed
7. Click the terminal icon again — panel collapses
8. Click the Play icon — panel opens with preview (not terminal)
9. Resize the bottom panel via drag handle — both modes respect the height
10. Type `exit` in a terminal — tab shows exit status

- [ ] **Step 3: Fix the close button hover visibility**

The tab close button uses `group-hover:opacity-100` but the parent doesn't have the `group` class. Update the tab button in `TerminalPanel.tsx` to add `group` to the parent:

```tsx
className={[
  'group flex items-center gap-1.5 px-2.5 h-7 rounded text-mf-small transition-colors shrink-0',
  // ...
].join(' ')}
```

And remove the `onMouseEnter` handler from the X button — the `group-hover` pattern handles it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(desktop): polish terminal tab close button hover state"
```

---

## Task 11: Changeset

- [ ] **Step 1: Create changeset**

```bash
pnpm changeset
```

Pick `@qlan-ro/mainframe-desktop` with a **minor** bump. Message:

```
Add integrated terminal panel with node-pty and xterm.js
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/
git commit -m "chore: add changeset for integrated terminal"
```
