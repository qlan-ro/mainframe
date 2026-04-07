# Integrated Terminal

Desktop-only (Electron) terminal panel in the bottom panel slot, alongside the existing preview panel. Uses node-pty in the main process and xterm.js in the renderer. No daemon involvement.

## UI State & Panel Switching

The UIStore gains a persisted field:

```ts
bottomPanelMode: 'preview' | 'terminal'  // default: 'preview'
```

Existing `panelVisible` and `panelCollapsed.bottom` continue to control visibility of the bottom panel slot.

### LeftRail

- Existing Play button toggles bottom panel with `mode: 'preview'`
- New `TerminalSquare` icon button toggles bottom panel with `mode: 'terminal'`
- Clicking the inactive mode's button switches mode (panel stays open)
- Clicking the active mode's button collapses the panel (toggle)

### BottomPanel

Reads `bottomPanelMode` from UIStore. Renders `PreviewTab` when `'preview'`, `TerminalPanel` when `'terminal'`. Resize handle and collapse logic unchanged.

## Electron Main Process — Terminal Manager

New file: `src/main/terminal-manager.ts`

Owns all PTY instances. Stores them in a `Map<string, IPty>`.

### IPC Channels

| Channel | Direction | Signature |
|---------|-----------|-----------|
| `terminal:create` | invoke | `(options: { cwd: string }) → { id: string }` |
| `terminal:write` | invoke | `(id: string, data: string) → void` |
| `terminal:resize` | invoke | `(id: string, cols: number, rows: number) → void` |
| `terminal:kill` | invoke | `(id: string) → void` |
| `terminal:data` | push (main → renderer) | `(id: string, data: string)` |
| `terminal:exit` | push (main → renderer) | `(id: string, exitCode: number)` |

### Spawn behavior

- Shell: `process.env.SHELL` on macOS/Linux, `powershell.exe` on Windows
- Environment inherited from `resolveShellEnv()` (already resolved at app startup)
- Terminal ID: `crypto.randomUUID()`

### Lifecycle

- All PTYs killed in `app.on('before-quit')` handler
- Each `BrowserWindow` gets its own terminals — `event.sender` (webContents) routes `terminal:data` events to the correct window

## Preload & Type Declarations

### Preload (`src/preload/index.ts`)

New `terminal` namespace on the `mainframe` API:

```ts
terminal: {
  create(options: { cwd: string }): Promise<{ id: string }>
  write(id: string, data: string): Promise<void>
  resize(id: string, cols: number, rows: number): Promise<void>
  kill(id: string): Promise<void>
  onData(callback: (id: string, data: string) => void): void
  onExit(callback: (id: string, exitCode: number) => void): void
  removeDataListener(): void   // removes terminal:data listener
  removeExitListener(): void   // removes terminal:exit listener
}
```

### Type declarations (`src/renderer/types/global.d.ts`)

`MainframeAPI` interface extended with the `terminal` namespace.

## Renderer — Terminal Panel

### Dependencies

- `xterm` + `@xterm/addon-fit` (renderer, pure JS)
- `node-pty` (main process, native — requires electron-rebuild)

### New store (`src/renderer/store/terminal.ts`)

```ts
interface TerminalTab {
  id: string    // matches the PTY id from main process
  name: string  // display name, e.g. "zsh", "zsh (2)"
}

interface TerminalState {
  terminals: TerminalTab[]
  activeTerminalId: string | null
  addTerminal: (tab: TerminalTab) => void
  removeTerminal: (id: string) => void
  setActiveTerminal: (id: string) => void
}
```

### TerminalPanel (`src/renderer/components/terminal/TerminalPanel.tsx`)

- Horizontal tab bar: each terminal is a tab, "+" button to create, "x" to close
- Minimize button in top-right (calls `setPanelVisible(false)`)
- On mount, auto-creates one terminal if none exist (cwd = active project root)
- Lazy-loaded via `React.lazy()` in BottomPanel (xterm.js is heavy)

### TerminalInstance (`src/renderer/components/terminal/TerminalInstance.tsx`)

- Creates xterm.js `Terminal` instance + `@xterm/addon-fit`
- On mount: `window.mainframe.terminal.create({ cwd })` → gets `id`
- Wires `terminal.onData` → `xterm.write(data)` (PTY output to screen)
- Wires `xterm.onData` → `terminal.write(id, data)` (keystrokes to PTY)
- `ResizeObserver` + `addon-fit` → auto-fit + `terminal:resize` on dimension changes
- On unmount / tab close: `terminal.kill(id)`, dispose xterm instance
- Themed to match the app (dark background from CSS variables)

## Error Handling & Edge Cases

**PTY spawn failure:** `terminal:create` rejects the promise. Renderer shows inline error in the tab and removes it from the store.

**Terminal exit:** Shell exits naturally → `terminal:exit` fires. Tab stays open with "[exited]" indicator. User closes manually.

**Window close / app quit:** All PTYs killed in `before-quit` handler. No orphaned processes.

**Multiple windows:** Terminal manager routes `terminal:data` via `event.sender` (webContents) to the correct window.

## Out of Scope

- Daemon-based terminals (multi-client access) — can be added later
- Terminal split panes — tabs only for v1
- Custom shell configuration UI — uses system default
- Search within terminal output
