# ⌘O Spotlight Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app-tauri ⌘O palette as a four-mode spotlight (files+sessions · `>` commands · `@` symbols · `#` changed files) with full artboard parity.

**Architecture:** Drop cmdk; render a custom mode engine over the plain `Dialog` primitive + a lifted `useListNavigation`. `@` symbols come from real LSP `workspace/symbol` over the existing transparent WS proxy (new client method, no core change). `#` changes reuse `getGitStatus` (status badge, no counts). `>` commands dispatch through new surface intents.

**Tech Stack:** React 18, TypeScript (strict, `noUncheckedIndexedAccess`), zustand, assistant-ui (`useAuiState`/`useAssistantRuntime`), shadcn `Dialog` (Radix), Tailwind v4, vitest + Testing Library, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-20-cmd-o-spotlight-design.md`

## Global Constraints

- Files < 300 lines; functions < 50 lines.
- Every interactive element has a stable scoped `data-testid` (`search-palette-<element>`); loop rows key off a stable domain id, never an array index.
- Theme tokens only — no phantom `mf-*` classes. Use registered tokens: `popover`, `mf-content2`, `mf-chip`, `mf-text-3`, `accent`, `muted-foreground`, `border`. Tailwind v4 `/opacity` is allowed here (color-mix).
- Compressed integer-spacing trap: for exact artboard px use arbitrary `[Npx]`; fractionals (`p-1.5`) stay standard.
- No `getState()` reach-through from feature components — go through surface intents.
- No silent catches — `console.warn('[tag] …', err)` in desktop/app-tauri code.
- Daemon/core contract is co-owned with mobile: **no core change** in this plan.
- Run touched vitest suites **individually** (cross-file `React.act` pollution): `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run <path>`.
- Typecheck (includes tests): `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`.
- Branch: `feat/app-tauri-wt` (never commit to `main`).

---

### Task 1: LSP SymbolKind → label mapper

**Files:**
- Create: `packages/app-tauri/src/lib/lsp/symbol-kind.ts`
- Test: `packages/app-tauri/src/lib/lsp/__tests__/symbol-kind.test.ts`

**Interfaces:**
- Produces: `symbolKindLabel(kind: number): string` — maps LSP `SymbolKind` enum numbers to a short tag ('fn','class','type','const','var','iface','enum','sym').

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-tauri/src/lib/lsp/__tests__/symbol-kind.test.ts
import { describe, it, expect } from 'vitest';
import { symbolKindLabel } from '../symbol-kind';

describe('symbolKindLabel', () => {
  it('maps known LSP SymbolKind numbers to short labels', () => {
    expect(symbolKindLabel(12)).toBe('fn');     // Function
    expect(symbolKindLabel(6)).toBe('fn');      // Method
    expect(symbolKindLabel(5)).toBe('class');   // Class
    expect(symbolKindLabel(11)).toBe('iface');  // Interface
    expect(symbolKindLabel(26)).toBe('type');   // TypeParameter
    expect(symbolKindLabel(14)).toBe('const');  // Constant
    expect(symbolKindLabel(13)).toBe('var');    // Variable
    expect(symbolKindLabel(10)).toBe('enum');   // Enum
  });

  it('falls back to "sym" for unknown kinds', () => {
    expect(symbolKindLabel(999)).toBe('sym');
    expect(symbolKindLabel(0)).toBe('sym');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/lsp/__tests__/symbol-kind.test.ts`
Expected: FAIL — cannot resolve `../symbol-kind`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app-tauri/src/lib/lsp/symbol-kind.ts
/**
 * Map an LSP SymbolKind enum number (LSP spec §SymbolKind) to a short tag
 * shown on `@` symbol rows in the spotlight palette.
 */
const LABELS: Record<number, string> = {
  5: 'class', // Class
  6: 'fn', // Method
  9: 'fn', // Constructor
  10: 'enum', // Enum
  11: 'iface', // Interface
  12: 'fn', // Function
  13: 'var', // Variable
  14: 'const', // Constant
  22: 'enum', // EnumMember
  23: 'type', // Struct
  26: 'type', // TypeParameter
};

export function symbolKindLabel(kind: number): string {
  return LABELS[kind] ?? 'sym';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/lsp/__tests__/symbol-kind.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/lib/lsp/symbol-kind.ts packages/app-tauri/src/lib/lsp/__tests__/symbol-kind.test.ts
git commit -m "feat(app-tauri): LSP SymbolKind→label mapper for spotlight @ mode"
```

---

### Task 2: `getWorkspaceSymbols` LSP client method

**Files:**
- Modify: `packages/app-tauri/src/lib/lsp/lsp-client.ts` (add `LspSymbol`, `getWorkspaceSymbols` to `LspProviders` + `LspClientManager`, a `fromLspUri` helper)
- Test: `packages/app-tauri/src/lib/lsp/__tests__/workspace-symbols.test.ts`

**Interfaces:**
- Consumes: existing private `sendRequest`, `clients` map, `LspClientEntry.resolvedBase`.
- Produces: `interface LspSymbol { name: string; kind: number; path: string; line: number }` and `getWorkspaceSymbols(projectId: string, language: string, query: string): Promise<LspSymbol[]>` on `LspClientManager` (and on the `LspProviders` interface).

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-tauri/src/lib/lsp/__tests__/workspace-symbols.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LspClientManager } from '../lsp-client';

/**
 * We exercise getWorkspaceSymbols by injecting a ready client entry directly
 * into the manager's private map and stubbing the WS send. This isolates the
 * request shape + SymbolInformation→LspSymbol mapping without a live socket.
 */
function makeReadyManager(sendImpl: (msg: any) => void) {
  const mgr = new LspClientManager(0);
  const entry = {
    ws: { send: (s: string) => sendImpl(JSON.parse(s)), readyState: 1, close: vi.fn() },
    resolvedBase: '/abs/project',
    chatId: undefined,
    requestId: 1,
    pending: new Map(),
    ready: true,
    openedUris: new Set<string>(),
  };
  // @ts-expect-error private access for test injection
  mgr.clients.set('proj:typescript', entry);
  return { mgr, entry };
}

describe('LspClientManager.getWorkspaceSymbols', () => {
  let sent: any;
  beforeEach(() => {
    sent = undefined;
  });

  it('returns [] when no ready client exists', async () => {
    const mgr = new LspClientManager(0);
    await expect(mgr.getWorkspaceSymbols('proj', 'typescript', 'Foo')).resolves.toEqual([]);
  });

  it('sends workspace/symbol and maps SymbolInformation to LspSymbol', async () => {
    const { mgr, entry } = makeReadyManager((msg) => {
      sent = msg;
      // Resolve the pending request with a SymbolInformation[] result.
      const handler = entry.pending.get(msg.id);
      handler.resolve([
        {
          name: 'useLayoutStore',
          kind: 12,
          location: {
            uri: 'file:///abs/project/src/store/layout.ts',
            range: { start: { line: 41, character: 6 }, end: { line: 41, character: 20 } },
          },
        },
      ]);
    });

    const result = await mgr.getWorkspaceSymbols('proj', 'typescript', 'useLayout');

    expect(sent.method).toBe('workspace/symbol');
    expect(sent.params).toEqual({ query: 'useLayout' });
    expect(result).toEqual([
      { name: 'useLayoutStore', kind: 12, path: 'src/store/layout.ts', line: 41 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/lsp/__tests__/workspace-symbols.test.ts`
Expected: FAIL — `getWorkspaceSymbols` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `packages/app-tauri/src/lib/lsp/lsp-client.ts`, add the type after `LspHover` (around line 61):

```ts
export interface LspSymbol {
  /** Symbol name (e.g. "useLayoutStore"). */
  name: string;
  /** LSP SymbolKind enum number. */
  kind: number;
  /** Project-relative path (e.g. "src/store/layout.ts"). */
  path: string;
  /** 0-based start line of the symbol. */
  line: number;
}
```

Add to the `LspProviders` interface (after `getHover`):

```ts
  getWorkspaceSymbols(projectId: string, language: string, query: string): Promise<LspSymbol[]>;
```

Add the method to `LspClientManager` (after `getHover`, before "Document management"):

```ts
  async getWorkspaceSymbols(projectId: string, language: string, query: string): Promise<LspSymbol[]> {
    const entry = this.clients.get(makeKey(projectId, language));
    if (!entry || !entry.ready) return [];
    try {
      const result = await this.sendRequest(entry, 'workspace/symbol', { query });
      return this.toLspSymbols(entry, result);
    } catch (err) {
      console.warn('[lsp] getWorkspaceSymbols failed', err);
      return [];
    }
  }
```

Add the private mappers (near `toLspLocations`):

```ts
  private fromLspUri(entry: LspClientEntry, uri: string): string {
    const prefix = `file://${entry.resolvedBase}/`;
    if (uri.startsWith(prefix)) return uri.slice(prefix.length);
    const bare = `file://${entry.resolvedBase}`;
    if (uri.startsWith(bare)) return uri.slice(bare.length).replace(/^\/+/, '');
    return uri.replace(/^file:\/\//, '');
  }

  private toLspSymbols(entry: LspClientEntry, result: unknown): LspSymbol[] {
    if (!Array.isArray(result)) return [];
    return (result as Array<{ name: string; kind: number; location: { uri: string; range: LspRange } }>).map(
      (s) => ({
        name: s.name,
        kind: s.kind,
        path: this.fromLspUri(entry, s.location.uri),
        line: s.location.range.start.line,
      }),
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/lsp/__tests__/workspace-symbols.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @qlan-ro/mainframe-app-tauri typecheck
git add packages/app-tauri/src/lib/lsp/lsp-client.ts packages/app-tauri/src/lib/lsp/__tests__/workspace-symbols.test.ts
git commit -m "feat(app-tauri): add getWorkspaceSymbols to the LSP client"
```

---

### Task 3: Command/toggle surface intents + subscriber

**Files:**
- Modify: `packages/app-tauri/src/store/surface-intents.ts` (add 3 intents to the union)
- Modify: `packages/app-tauri/src/store/intent-subscriber.ts` (handle the 3 intents)
- Test: `packages/app-tauri/src/store/__tests__/intent-subscriber.commands.test.ts`

**Interfaces:**
- Produces: `SurfaceIntent` gains `{ type: 'open-settings' }`, `{ type: 'toggle-sidebar' }`, `{ type: 'toggle-inspector' }`. `subscribeToFileIntents()` dispatches them to `useSettingsStore.open()`, `useLayoutStore.toggleSidebar()`, `useLayoutStore.toggleInspector()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-tauri/src/store/__tests__/intent-subscriber.commands.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeToFileIntents } from '../intent-subscriber';
import { emitSurfaceIntent } from '../surface-intents';
import { useSettingsStore } from '../settings';
import { useLayoutStore } from '../layout';

describe('intent-subscriber — command intents', () => {
  let unsub: () => void;
  beforeEach(() => {
    unsub = subscribeToFileIntents();
  });
  afterEach(() => unsub());

  it('open-settings opens the settings store', () => {
    useSettingsStore.setState({ isOpen: false });
    emitSurfaceIntent({ type: 'open-settings' });
    expect(useSettingsStore.getState().isOpen).toBe(true);
  });

  it('toggle-sidebar flips sidebarVisible', () => {
    const before = useLayoutStore.getState().sidebarVisible;
    emitSurfaceIntent({ type: 'toggle-sidebar' });
    expect(useLayoutStore.getState().sidebarVisible).toBe(!before);
  });

  it('toggle-inspector flips inspectorVisible', () => {
    const before = useLayoutStore.getState().inspectorVisible;
    emitSurfaceIntent({ type: 'toggle-inspector' });
    expect(useLayoutStore.getState().inspectorVisible).toBe(!before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/store/__tests__/intent-subscriber.commands.test.ts`
Expected: FAIL — TS error: `'open-settings'` not assignable to `SurfaceIntent` (and no handler).

- [ ] **Step 3: Write minimal implementation**

In `surface-intents.ts`, add to the `SurfaceIntent` union (after `open-review`):

```ts
  /** Open the settings dialog. */
  | { type: 'open-settings' }
  /** Toggle the left sidebar. */
  | { type: 'toggle-sidebar' }
  /** Toggle the right inspector. */
  | { type: 'toggle-inspector' };
```

In `intent-subscriber.ts`, add the settings import at the top with the other store imports:

```ts
import { useSettingsStore } from './settings';
```

Inside `subscribeToFileIntents`, add before the closing `inspector-tab` comment:

```ts
    if (intent.type === 'open-settings') {
      useSettingsStore.getState().open();
      return;
    }

    if (intent.type === 'toggle-sidebar') {
      useLayoutStore.getState().toggleSidebar();
      return;
    }

    if (intent.type === 'toggle-inspector') {
      useLayoutStore.getState().toggleInspector();
      return;
    }
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/store/__tests__/intent-subscriber.commands.test.ts`
Expected: PASS (3 tests).
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/store/surface-intents.ts packages/app-tauri/src/store/intent-subscriber.ts packages/app-tauri/src/store/__tests__/intent-subscriber.commands.test.ts
git commit -m "feat(app-tauri): open-settings / toggle-sidebar / toggle-inspector intents"
```

---

### Task 4: `parseQuery` mode engine

**Files:**
- Create: `packages/app-tauri/src/features/palette/palette-modes.ts`
- Test: `packages/app-tauri/src/features/palette/__tests__/palette-modes.test.ts`

**Interfaces:**
- Produces: `type PaletteMode = 'file' | 'cmd' | 'sym' | 'chg'`; `interface ParsedQuery { mode: PaletteMode; term: string; chip: string | null; placeholder: string }`; `parseQuery(raw: string): ParsedQuery`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-tauri/src/features/palette/__tests__/palette-modes.test.ts
import { describe, it, expect } from 'vitest';
import { parseQuery } from '../palette-modes';

describe('parseQuery', () => {
  it('defaults to file mode and trims the term', () => {
    expect(parseQuery('  layout ')).toEqual({
      mode: 'file',
      term: 'layout',
      chip: null,
      placeholder: 'Search files…  · type > commands  @ symbols  # changes',
    });
  });

  it('> selects command mode and strips the prefix', () => {
    const r = parseQuery('> rev');
    expect(r.mode).toBe('cmd');
    expect(r.term).toBe('rev');
    expect(r.chip).toBe('Commands');
    expect(r.placeholder).toBe('Run a command…');
  });

  it('@ selects symbol mode', () => {
    const r = parseQuery('@useLayout');
    expect(r.mode).toBe('sym');
    expect(r.term).toBe('useLayout');
    expect(r.chip).toBe('Symbols');
  });

  it('# selects changes mode', () => {
    const r = parseQuery('#Side');
    expect(r.mode).toBe('chg');
    expect(r.term).toBe('Side');
    expect(r.chip).toBe('Changes');
  });

  it('a lone prefix yields an empty term', () => {
    expect(parseQuery('>').term).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/palette-modes.test.ts`
Expected: FAIL — cannot resolve `../palette-modes`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app-tauri/src/features/palette/palette-modes.ts
export type PaletteMode = 'file' | 'cmd' | 'sym' | 'chg';

export interface ParsedQuery {
  mode: PaletteMode;
  /** Query with the mode prefix stripped and trimmed. */
  term: string;
  /** Mode chip label shown in the field, or null for the default mode. */
  chip: string | null;
  placeholder: string;
}

const FILE_PLACEHOLDER = 'Search files…  · type > commands  @ symbols  # changes';

export function parseQuery(raw: string): ParsedQuery {
  if (raw.startsWith('>')) {
    return { mode: 'cmd', term: raw.slice(1).trim(), chip: 'Commands', placeholder: 'Run a command…' };
  }
  if (raw.startsWith('@')) {
    return { mode: 'sym', term: raw.slice(1).trim(), chip: 'Symbols', placeholder: 'Go to symbol…' };
  }
  if (raw.startsWith('#')) {
    return { mode: 'chg', term: raw.slice(1).trim(), chip: 'Changes', placeholder: 'Filter changed files…' };
  }
  return { mode: 'file', term: raw.trim(), chip: null, placeholder: FILE_PLACEHOLDER };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/palette-modes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/features/palette/palette-modes.ts packages/app-tauri/src/features/palette/__tests__/palette-modes.test.ts
git commit -m "feat(app-tauri): spotlight palette mode parser"
```

---

### Task 5: Command registry

**Files:**
- Create: `packages/app-tauri/src/features/palette/palette-commands.ts`
- Test: `packages/app-tauri/src/features/palette/__tests__/palette-commands.test.ts`

**Interfaces:**
- Consumes: `emitSurfaceIntent` from `@/store/surface-intents` (incl. the Task 3 intents).
- Produces: `interface PaletteCommand { id: string; label: string; hint?: string; run: () => void }`; `getPaletteCommands(): PaletteCommand[]`; `filterCommands(cmds: PaletteCommand[], term: string): PaletteCommand[]` (case-insensitive substring on `label`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-tauri/src/features/palette/__tests__/palette-commands.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a),
}));

const { getPaletteCommands, filterCommands } = await import('../palette-commands');

describe('palette-commands', () => {
  it('exposes the six artboard commands', () => {
    const ids = getPaletteCommands().map((c) => c.id);
    expect(ids).toEqual(['review', 'settings', 'sidebar', 'inspector', 'files', 'run']);
  });

  it('each command emits the right intent on run()', () => {
    const byId = Object.fromEntries(getPaletteCommands().map((c) => [c.id, c]));
    mockEmit.mockClear();
    byId.review!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-review' });
    byId.settings!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-settings' });
    byId.sidebar!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'toggle-sidebar' });
    byId.inspector!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'toggle-inspector' });
    byId.files!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'activate-surface', surface: 'files' });
    byId.run!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'activate-surface', surface: 'run' });
  });

  it('filterCommands matches label case-insensitively', () => {
    const r = filterCommands(getPaletteCommands(), 'sett');
    expect(r.map((c) => c.id)).toEqual(['settings']);
    expect(filterCommands(getPaletteCommands(), '')).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/palette-commands.test.ts`
Expected: FAIL — cannot resolve `../palette-commands`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app-tauri/src/features/palette/palette-commands.ts
import { emitSurfaceIntent } from '@/store/surface-intents';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Keyboard hint glyphs (e.g. "⌘⇧R"); rendered as kbd chips. */
  hint?: string;
  run: () => void;
}

export function getPaletteCommands(): PaletteCommand[] {
  return [
    { id: 'review', label: 'Review changes…', hint: '⌘⇧R', run: () => emitSurfaceIntent({ type: 'open-review' }) },
    { id: 'settings', label: 'Open Settings…', hint: '⌘,', run: () => emitSurfaceIntent({ type: 'open-settings' }) },
    { id: 'sidebar', label: 'Toggle Sidebar', hint: '⌘\\', run: () => emitSurfaceIntent({ type: 'toggle-sidebar' }) },
    { id: 'inspector', label: 'Toggle Inspector', run: () => emitSurfaceIntent({ type: 'toggle-inspector' }) },
    { id: 'files', label: 'Reveal Files surface', run: () => emitSurfaceIntent({ type: 'activate-surface', surface: 'files' }) },
    { id: 'run', label: 'Reveal Run surface', run: () => emitSurfaceIntent({ type: 'activate-surface', surface: 'run' }) },
  ];
}

export function filterCommands(cmds: PaletteCommand[], term: string): PaletteCommand[] {
  const t = term.trim().toLowerCase();
  if (!t) return cmds;
  return cmds.filter((c) => c.label.toLowerCase().includes(t));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/palette-commands.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/features/palette/palette-commands.ts packages/app-tauri/src/features/palette/__tests__/palette-commands.test.ts
git commit -m "feat(app-tauri): spotlight command registry"
```

---

### Task 6: Lift `useListNavigation` to a shared hook

**Files:**
- Create: `packages/app-tauri/src/lib/ui/use-list-navigation.ts`
- Modify: `packages/app-tauri/src/features/files/use-file-search.tsx` (remove the local impl; re-export from the new module)
- Test: `packages/app-tauri/src/lib/ui/__tests__/use-list-navigation.test.tsx`

**Interfaces:**
- Produces: `useListNavigation(count: number, onConfirm: (index: number) => void): { activeIndex: number; handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void; rowRefs: MutableRefObject<(HTMLButtonElement | null)[]> }` — identical signature to the existing one (so `FilePickerDialog`'s import keeps working via the re-export).

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app-tauri/src/lib/ui/__tests__/use-list-navigation.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useListNavigation } from '../use-list-navigation';

function press(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLInputElement>;
}

describe('useListNavigation', () => {
  it('clamps ArrowDown/ArrowUp within [0, count-1]', () => {
    const { result } = renderHook(() => useListNavigation(3, vi.fn()));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.handleKeyDown(press('ArrowDown')));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.handleKeyDown(press('ArrowUp')));
    act(() => result.current.handleKeyDown(press('ArrowUp')));
    expect(result.current.activeIndex).toBe(0);
  });

  it('Enter confirms the active index', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useListNavigation(2, onConfirm));
    act(() => result.current.handleKeyDown(press('ArrowDown')));
    act(() => result.current.handleKeyDown(press('Enter')));
    expect(onConfirm).toHaveBeenCalledWith(1);
  });

  it('resets active index to 0 when count changes', () => {
    const { result, rerender } = renderHook(({ n }) => useListNavigation(n, vi.fn()), {
      initialProps: { n: 5 },
    });
    act(() => result.current.handleKeyDown(press('ArrowDown')));
    expect(result.current.activeIndex).toBe(1);
    rerender({ n: 2 });
    expect(result.current.activeIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/ui/__tests__/use-list-navigation.test.tsx`
Expected: FAIL — cannot resolve `../use-list-navigation`.

- [ ] **Step 3: Write minimal implementation**

Create the shared module by moving the existing impl verbatim out of `use-file-search.tsx`:

```ts
// packages/app-tauri/src/lib/ui/use-list-navigation.ts
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** Keyboard nav for a single-column listbox driven from a text input. */
export function useListNavigation(count: number, onConfirm: (index: number) => void) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [count]);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.min(i + 1, count - 1);
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.max(i - 1, 0);
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (count > 0) onConfirm(Math.min(activeIndex, count - 1));
      }
    },
    [count, activeIndex, onConfirm],
  );
  return { activeIndex, handleKeyDown, rowRefs };
}
```

In `use-file-search.tsx`, delete the local `useListNavigation` definition (the `export function useListNavigation(...) {...}` block, ~lines 19–49) and add a re-export near the top imports so existing consumers keep working:

```ts
export { useListNavigation } from '@/lib/ui/use-list-navigation';
```

Remove now-unused imports from `use-file-search.tsx` if `useCallback`/`KeyboardEvent` are no longer referenced elsewhere in that file (the `useFileSearch`/`useDebounce`/`FileRow` exports still use `useEffect`/`useRef`/`useState`).

- [ ] **Step 4: Run tests + FilePicker regression + typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/ui/__tests__/use-list-navigation.test.tsx`
Expected: PASS (3 tests).
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/files/__tests__/FilePickerDialog.test.tsx`
Expected: PASS (FilePicker still navigates via the re-export).
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/lib/ui/use-list-navigation.ts packages/app-tauri/src/lib/ui/__tests__/use-list-navigation.test.tsx packages/app-tauri/src/features/files/use-file-search.tsx
git commit -m "refactor(app-tauri): lift useListNavigation into lib/ui (shared)"
```

---

### Task 7: `useWorkspaceSymbols` hook

**Files:**
- Create: `packages/app-tauri/src/features/palette/use-workspace-symbols.ts`
- Test: `packages/app-tauri/src/features/palette/__tests__/use-workspace-symbols.test.tsx`

**Interfaces:**
- Consumes: `lspClientManager`, `initLspPort`, `getLspLanguage` from `@/lib/lsp`; `useTabsStore` from `@/store/tabs`; `useDebounce` from `@/features/files/use-file-search`; `LspSymbol` (Task 2).
- Produces: `useWorkspaceSymbols(args: { port: number; projectId?: string; projectPath?: string; chatId?: string; term: string; enabled: boolean }): { symbols: LspSymbol[]; loading: boolean }` and `pickSymbolLanguage(): string` (active editor tab's language via `getLspLanguage`, else `'typescript'`).

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app-tauri/src/features/palette/__tests__/use-workspace-symbols.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const ensureClient = vi.fn().mockResolvedValue(undefined);
const hasClient = vi.fn().mockReturnValue(true);
const getWorkspaceSymbols = vi.fn();
vi.mock('@/lib/lsp', () => ({
  lspClientManager: {
    ensureClient: (...a: unknown[]) => ensureClient(...a),
    hasClient: (...a: unknown[]) => hasClient(...a),
    getWorkspaceSymbols: (...a: unknown[]) => getWorkspaceSymbols(...a),
  },
  initLspPort: () => Promise.resolve(),
  getLspLanguage: (p: string) => (p.endsWith('.ts') ? 'typescript' : null),
}));
vi.mock('@/store/tabs', () => ({
  useTabsStore: { getState: () => ({ tabs: [], activeTabId: null }) },
}));

const { useWorkspaceSymbols } = await import('../use-workspace-symbols');

describe('useWorkspaceSymbols', () => {
  beforeEach(() => {
    ensureClient.mockClear();
    getWorkspaceSymbols.mockClear();
  });

  it('returns [] and does not query when disabled', async () => {
    const { result } = renderHook(() =>
      useWorkspaceSymbols({ port: 1, projectId: 'p', projectPath: '/p', chatId: undefined, term: 'Foo', enabled: false }),
    );
    expect(result.current.symbols).toEqual([]);
    expect(getWorkspaceSymbols).not.toHaveBeenCalled();
  });

  it('queries workspace symbols when enabled with a term', async () => {
    getWorkspaceSymbols.mockResolvedValue([{ name: 'Foo', kind: 5, path: 'src/Foo.ts', line: 2 }]);
    const { result } = renderHook(() =>
      useWorkspaceSymbols({ port: 1, projectId: 'p', projectPath: '/p', chatId: undefined, term: 'Foo', enabled: true }),
    );
    await waitFor(() => expect(result.current.symbols).toHaveLength(1));
    expect(getWorkspaceSymbols).toHaveBeenCalledWith('p', 'typescript', 'Foo');
    expect(result.current.symbols[0]).toEqual({ name: 'Foo', kind: 5, path: 'src/Foo.ts', line: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/use-workspace-symbols.test.tsx`
Expected: FAIL — cannot resolve `../use-workspace-symbols`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app-tauri/src/features/palette/use-workspace-symbols.ts
import { useEffect, useRef, useState } from 'react';
import { lspClientManager, initLspPort, getLspLanguage, type LspSymbol } from '@/lib/lsp';
import { useTabsStore } from '@/store/tabs';
import { useDebounce } from '@/features/files/use-file-search';

/** The active editor tab's LSP language, else 'typescript' (v1 default). */
export function pickSymbolLanguage(): string {
  const { tabs, activeTabId } = useTabsStore.getState();
  const active = tabs.find((t) => t.id === activeTabId);
  return (active ? getLspLanguage(active.path) : null) ?? 'typescript';
}

interface Args {
  port: number;
  projectId?: string;
  projectPath?: string;
  chatId?: string;
  term: string;
  enabled: boolean;
}

export function useWorkspaceSymbols({ port, projectId, projectPath, chatId, term, enabled }: Args): {
  symbols: LspSymbol[];
  loading: boolean;
} {
  const debounced = useDebounce(term, 250);
  const [symbols, setSymbols] = useState<LspSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !projectId || debounced.trim().length < 1) {
      reqIdRef.current++;
      setSymbols([]);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    const language = pickSymbolLanguage();
    setLoading(true);
    void (async () => {
      try {
        await initLspPort();
        if (!lspClientManager.hasClient(projectId, language)) {
          await lspClientManager.ensureClient(projectId, language, projectPath ?? '', chatId);
        }
        const result = await lspClientManager.getWorkspaceSymbols(projectId, language, debounced.trim());
        if (reqId === reqIdRef.current) setSymbols(result);
      } catch (err) {
        console.warn('[use-workspace-symbols] query failed', err);
        if (reqId === reqIdRef.current) setSymbols([]);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    })();
  }, [enabled, port, projectId, projectPath, chatId, debounced]);

  return { symbols, loading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/use-workspace-symbols.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/features/palette/use-workspace-symbols.ts packages/app-tauri/src/features/palette/__tests__/use-workspace-symbols.test.tsx
git commit -m "feat(app-tauri): useWorkspaceSymbols hook (@ symbol search)"
```

---

### Task 8: `useSpotlightResults` aggregator

**Files:**
- Create: `packages/app-tauri/src/features/palette/use-spotlight-results.ts`
- Test: `packages/app-tauri/src/features/palette/__tests__/use-spotlight-results.test.tsx`

**Interfaces:**
- Consumes: `parseQuery`/`ParsedQuery`/`PaletteMode` (Task 4); `getPaletteCommands`/`filterCommands` (Task 5); `useWorkspaceSymbols` (Task 7); `useFileSearch`, `dirOf` from `@/features/files/use-file-search`; `getGitStatus`, `GitStatusFile` from `@/lib/api/git`; `gitStatusKind`, `KIND_LABEL` from `@/lib/git-status-kind`; `symbolKindLabel` (Task 1); `SessionItem` from `@/features/sessions/view-model/chat-to-thread-custom`; `emitSurfaceIntent`.
- Produces:
  - `type RowType = 'session' | 'file' | 'command' | 'symbol' | 'change'`
  - `interface SpotlightRow { type: RowType; id: string; testid: string; title: string; sub?: string; hint?: string; tag?: string; status?: string; run: () => void }`
  - `useSpotlightResults(args: { parsed: ParsedQuery; port: number; projectId?: string; projectPath?: string; chatId?: string; sessions: SessionItem[]; switchToThread: (id: string) => void }): { rows: SpotlightRow[]; loading: boolean }`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app-tauri/src/features/palette/__tests__/use-spotlight-results.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { parseQuery } from '../palette-modes';

const mockSearchFiles = vi.fn();
vi.mock('@/lib/api/files', () => ({ searchFiles: (...a: unknown[]) => mockSearchFiles(...a) }));
const mockGitStatus = vi.fn();
vi.mock('@/lib/api/git', () => ({ getGitStatus: (...a: unknown[]) => mockGitStatus(...a) }));
const mockSymbols = vi.fn().mockReturnValue({ symbols: [], loading: false });
vi.mock('../use-workspace-symbols', () => ({ useWorkspaceSymbols: (a: unknown) => mockSymbols(a) }));
const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

const { useSpotlightResults } = await import('../use-spotlight-results');

const sessions = [
  { id: 's1', remoteId: 's1', title: 'Build the palette' },
  { id: 's2', remoteId: 's2', title: 'Fix the editor' },
];

beforeEach(() => {
  mockSearchFiles.mockReset();
  mockGitStatus.mockReset();
  mockEmit.mockReset();
});

describe('useSpotlightResults', () => {
  it('file mode: filters sessions by title and includes file rows (not re-filtered)', async () => {
    mockSearchFiles.mockResolvedValue([{ name: 'z.ts', path: 'src/z.ts', type: 'file', exact: false }]);
    const { result } = renderHook(() =>
      useSpotlightResults({ parsed: parseQuery('palette'), port: 1, projectId: 'p', sessions, switchToThread: vi.fn() }),
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.type === 'file')).toBe(true));
    const types = result.current.rows.map((r) => r.type);
    // Only the title-matching session survives; the unrelated file row is kept verbatim.
    expect(result.current.rows.filter((r) => r.type === 'session').map((r) => r.id)).toEqual(['s1']);
    expect(result.current.rows.find((r) => r.type === 'file')?.id).toBe('src/z.ts');
    expect(types).toContain('file');
  });

  it('command mode: returns filtered command rows', () => {
    const { result } = renderHook(() =>
      useSpotlightResults({ parsed: parseQuery('> settings'), port: 1, projectId: 'p', sessions, switchToThread: vi.fn() }),
    );
    expect(result.current.rows.map((r) => r.id)).toEqual(['settings']);
    expect(result.current.rows[0]!.type).toBe('command');
  });

  it('changes mode: maps git status to change rows with status label', async () => {
    mockGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);
    const { result } = renderHook(() =>
      useSpotlightResults({ parsed: parseQuery('#'), port: 1, projectId: 'p', sessions, switchToThread: vi.fn() }),
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.type === 'change')).toBe(true));
    const row = result.current.rows.find((r) => r.type === 'change')!;
    expect(row.id).toBe('src/a.ts');
    expect(row.status).toBe('M');
  });

  it('session row run() switches thread and activates chat', () => {
    const switchToThread = vi.fn();
    const { result } = renderHook(() =>
      useSpotlightResults({ parsed: parseQuery(''), port: 1, projectId: 'p', sessions, switchToThread }),
    );
    result.current.rows.find((r) => r.type === 'session')!.run();
    expect(switchToThread).toHaveBeenCalledWith('s1');
    expect(mockEmit).toHaveBeenCalledWith({ type: 'activate-surface', surface: 'chat' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/use-spotlight-results.test.tsx`
Expected: FAIL — cannot resolve `../use-spotlight-results`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app-tauri/src/features/palette/use-spotlight-results.ts
import { useEffect, useMemo, useState } from 'react';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useFileSearch, dirOf } from '@/features/files/use-file-search';
import { getGitStatus, type GitStatusFile } from '@/lib/api/git';
import { gitStatusKind, KIND_LABEL } from '@/lib/git-status-kind';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { symbolKindLabel } from '@/lib/lsp/symbol-kind';
import type { ParsedQuery } from './palette-modes';
import { getPaletteCommands, filterCommands } from './palette-commands';
import { useWorkspaceSymbols } from './use-workspace-symbols';

export type RowType = 'session' | 'file' | 'command' | 'symbol' | 'change';

export interface SpotlightRow {
  type: RowType;
  /** Stable domain id (session id / path / command id / `${path}:${line}`). */
  id: string;
  testid: string;
  title: string;
  sub?: string;
  hint?: string;
  tag?: string;
  status?: string;
  run: () => void;
}

interface Args {
  parsed: ParsedQuery;
  port: number;
  projectId?: string;
  projectPath?: string;
  chatId?: string;
  sessions: SessionItem[];
  switchToThread: (id: string) => void;
}

/** Working-tree changes, fetched only while in `chg` mode. */
function useGitChanges(port: number, projectId: string | undefined, chatId: string | undefined, enabled: boolean) {
  const [files, setFiles] = useState<GitStatusFile[]>([]);
  useEffect(() => {
    if (!enabled || !projectId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    getGitStatus(port, projectId, chatId)
      .then((f) => {
        if (!cancelled) setFiles(f);
      })
      .catch((err) => {
        console.warn('[use-spotlight-results] getGitStatus failed', err);
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, port, projectId, chatId]);
  return files;
}

export function useSpotlightResults({
  parsed,
  port,
  projectId,
  projectPath,
  chatId,
  sessions,
  switchToThread,
}: Args): { rows: SpotlightRow[]; loading: boolean } {
  const { mode, term } = parsed;

  // All data hooks are called unconditionally; fetching is gated by mode.
  const fileSearch = useFileSearch(port, projectId, chatId, mode === 'file' ? term : '', 2);
  const symbolSearch = useWorkspaceSymbols({
    port,
    projectId,
    projectPath,
    chatId,
    term,
    enabled: mode === 'sym',
  });
  const changes = useGitChanges(port, projectId, chatId, mode === 'chg');

  const rows = useMemo<SpotlightRow[]>(() => {
    if (mode === 'cmd') {
      return filterCommands(getPaletteCommands(), term).map((c) => ({
        type: 'command',
        id: c.id,
        testid: `search-palette-command-row-${c.id}`,
        title: c.label,
        hint: c.hint,
        run: c.run,
      }));
    }

    if (mode === 'sym') {
      return symbolSearch.symbols.map((s) => ({
        type: 'symbol',
        id: `${s.path}:${s.line}`,
        testid: `search-palette-symbol-row-${s.path}:${s.line}`,
        title: s.name,
        sub: s.path,
        tag: symbolKindLabel(s.kind),
        run: () => emitSurfaceIntent({ type: 'open-file', path: s.path, line: s.line, character: 0 }),
      }));
    }

    if (mode === 'chg') {
      const t = term.toLowerCase();
      return changes
        .filter((f) => !t || f.path.toLowerCase().includes(t))
        .map((f) => ({
          type: 'change',
          id: f.path,
          testid: `search-palette-change-row-${f.path}`,
          title: f.path.split('/').pop() ?? f.path,
          sub: dirOf(f.path),
          status: KIND_LABEL[gitStatusKind(f.status)],
          run: () => emitSurfaceIntent({ type: 'open-diff', path: f.path }),
        }));
    }

    // file (default) mode: Sessions (filtered + capped) + Files.
    const t = term.toLowerCase();
    const cap = term ? 10 : 5;
    const sessionRows: SpotlightRow[] = sessions
      .filter((s) => (s.title ?? 'Untitled').toLowerCase().includes(t))
      .slice(0, cap)
      .map((s) => {
        const targetId = s.remoteId ?? s.id;
        return {
          type: 'session',
          id: targetId,
          testid: `search-palette-session-row-${targetId}`,
          title: s.title ?? 'Untitled',
          run: () => {
            switchToThread(targetId);
            emitSurfaceIntent({ type: 'activate-surface', surface: 'chat' });
          },
        };
      });
    const fileRows: SpotlightRow[] = fileSearch.results.map((r) => ({
      type: 'file',
      id: r.path,
      testid: `search-palette-file-row-${r.path}`,
      title: r.name,
      sub: dirOf(r.path),
      run: () => emitSurfaceIntent({ type: 'open-file', path: r.path }),
    }));
    return [...sessionRows, ...fileRows];
  }, [mode, term, sessions, fileSearch.results, symbolSearch.symbols, changes, switchToThread]);

  const loading = (mode === 'file' && fileSearch.loading) || (mode === 'sym' && symbolSearch.loading);
  return { rows, loading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/use-spotlight-results.test.tsx`
Expected: PASS (4 tests).
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/features/palette/use-spotlight-results.ts packages/app-tauri/src/features/palette/__tests__/use-spotlight-results.test.tsx
git commit -m "feat(app-tauri): useSpotlightResults — per-mode row aggregator"
```

---

### Task 9: `SpotlightRow` presentational component

**Files:**
- Create: `packages/app-tauri/src/features/palette/SpotlightRow.tsx`
- Test: `packages/app-tauri/src/features/palette/__tests__/SpotlightRow.test.tsx`

**Interfaces:**
- Consumes: `SpotlightRow` (data, Task 8), `RowType`.
- Produces: `SpotlightRowView({ row, isActive, rowRef, onSelect }: { row: SpotlightRow; isActive: boolean; rowRef: (el: HTMLButtonElement | null) => void; onSelect: (row: SpotlightRow) => void }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app-tauri/src/features/palette/__tests__/SpotlightRow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpotlightRowView } from '../SpotlightRow';
import type { SpotlightRow } from '../use-spotlight-results';

const cmdRow: SpotlightRow = {
  type: 'command',
  id: 'review',
  testid: 'search-palette-command-row-review',
  title: 'Review changes…',
  hint: '⌘⇧R',
  run: vi.fn(),
};

describe('SpotlightRowView', () => {
  it('renders the testid, title and a kbd chip per hint glyph', () => {
    render(<SpotlightRowView row={cmdRow} isActive rowRef={() => {}} onSelect={() => {}} />);
    const el = screen.getByTestId('search-palette-command-row-review');
    expect(el).toBeTruthy();
    expect(screen.getByText('Review changes…')).toBeTruthy();
    // "⌘⇧R" → 3 kbd chips
    expect(el.querySelectorAll('kbd')).toHaveLength(3);
  });

  it('renders a status badge for change rows', () => {
    const chg: SpotlightRow = {
      type: 'change',
      id: 'src/a.ts',
      testid: 'search-palette-change-row-src/a.ts',
      title: 'a.ts',
      sub: 'src',
      status: 'M',
      run: vi.fn(),
    };
    render(<SpotlightRowView row={chg} isActive={false} rowRef={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('calls onSelect with the row on click', async () => {
    const onSelect = vi.fn();
    render(<SpotlightRowView row={cmdRow} isActive={false} rowRef={() => {}} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('search-palette-command-row-review'));
    expect(onSelect).toHaveBeenCalledWith(cmdRow);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/SpotlightRow.test.tsx`
Expected: FAIL — cannot resolve `../SpotlightRow`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/app-tauri/src/features/palette/SpotlightRow.tsx
import { FileIcon, MessageSquareIcon, BracesIcon, FileDiffIcon, ChevronRightIcon, CornerDownLeftIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { RowType, SpotlightRow } from './use-spotlight-results';

const ICONS: Record<RowType, ComponentType<{ className?: string }>> = {
  session: MessageSquareIcon,
  file: FileIcon,
  symbol: BracesIcon,
  change: FileDiffIcon,
  command: ChevronRightIcon,
};

export function SpotlightRowView({
  row,
  isActive,
  rowRef,
  onSelect,
}: {
  row: SpotlightRow;
  isActive: boolean;
  rowRef: (el: HTMLButtonElement | null) => void;
  onSelect: (row: SpotlightRow) => void;
}) {
  const Icon = ICONS[row.type];
  const mono = row.type !== 'command';
  const hasTrailing = Boolean(row.hint || row.tag || row.status);
  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={isActive}
      data-active={isActive ? 'true' : 'false'}
      data-testid={row.testid}
      onClick={() => onSelect(row)}
      className={`flex h-[40px] w-full items-center gap-[11px] rounded-[8px] px-[10px] text-left outline-none ${
        isActive ? 'bg-accent/8' : ''
      }`}
    >
      <span className="inline-flex w-5 shrink-0 justify-center">
        <Icon className={`size-[15px] ${isActive ? 'text-accent' : 'text-mf-text-3'}`} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span
          className={`truncate text-body leading-tight ${mono ? 'font-mono' : ''} ${
            isActive ? 'font-semibold' : 'font-medium'
          } text-foreground`}
        >
          {row.title}
        </span>
        {row.sub && <span className="truncate text-caption leading-tight text-mf-text-3">{row.sub}</span>}
      </span>

      {row.status && (
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-mf-chip text-micro font-bold text-mf-text-3">
          {row.status}
        </span>
      )}
      {row.tag && (
        <span className="shrink-0 rounded-[6px] bg-mf-chip px-[7px] py-[2px] text-micro font-semibold text-mf-text-3">
          {row.tag}
        </span>
      )}
      {row.hint && (
        <span className="inline-flex shrink-0 gap-[3px]">
          {row.hint.split('').map((c, i) => (
            <kbd
              key={`${row.id}-k${i}`}
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] bg-mf-chip px-1 text-micro font-semibold text-mf-text-3"
            >
              {c}
            </kbd>
          ))}
        </span>
      )}
      {isActive && !hasTrailing && <CornerDownLeftIcon className="size-[13px] shrink-0 text-mf-text-3" />}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/SpotlightRow.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/features/palette/SpotlightRow.tsx packages/app-tauri/src/features/palette/__tests__/SpotlightRow.test.tsx
git commit -m "feat(app-tauri): SpotlightRow renderer (per-type affordances)"
```

---

### Task 10: `SpotlightPalette` shell

**Files:**
- Create: `packages/app-tauri/src/features/palette/SpotlightPalette.tsx`
- Test: `packages/app-tauri/src/features/palette/__tests__/SpotlightPalette.test.tsx`

**Interfaces:**
- Consumes: `useOverlaysStore` (`paletteOpen`/`setPaletteOpen`); `Dialog`/`DialogContent`/`DialogTitle` from `@/components/ui/dialog` (pass `hideClose`); `parseQuery` (Task 4); `useSpotlightResults` (Task 8); `SpotlightRowView` (Task 9); `useListNavigation` from `@/lib/ui/use-list-navigation`; `useAssistantRuntime`/`useAuiState`; `threadItemsToSessionItems`; `useDaemonPort`; `useActiveIdentity`.
- Produces: `SpotlightPalette(): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app-tauri/src/features/palette/__tests__/SpotlightPalette.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOverlaysStore } from '@/store/overlays';

const mockSearchFiles = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/api/files', () => ({ searchFiles: (...a: unknown[]) => mockSearchFiles(...a) }));
vi.mock('@/lib/api/git', () => ({ getGitStatus: vi.fn().mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]) }));
const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a), onSurfaceIntent: vi.fn(() => () => {}) }));
const mockSwitch = vi.fn();
vi.mock('@assistant-ui/react', async (orig) => {
  const o = await orig<typeof import('@assistant-ui/react')>();
  return {
    ...o,
    useAssistantRuntime: () => ({ threads: { switchToThread: mockSwitch } }),
    useAuiState: (sel: (s: unknown) => unknown) =>
      sel({ threads: { threadItems: [{ id: 'c1', remoteId: 'c1', title: 'Build palette', status: 'regular', custom: { projectId: 'p' } }] } }),
  };
});
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'p', chatId: 'c1', projectPath: '/p', projectName: 'P' }),
}));

const { SpotlightPalette } = await import('../SpotlightPalette');

function open() {
  act(() => useOverlaysStore.getState().setPaletteOpen(true));
}
beforeEach(() => {
  mockEmit.mockReset();
  mockSwitch.mockReset();
  act(() => useOverlaysStore.setState({ paletteOpen: false }));
});
afterEach(() => act(() => useOverlaysStore.setState({ paletteOpen: false })));

describe('SpotlightPalette', () => {
  it('is absent when closed, present when open', async () => {
    render(<SpotlightPalette />);
    expect(screen.queryByTestId('search-palette-input')).toBeNull();
    open();
    await waitFor(() => expect(screen.queryByTestId('search-palette-input')).not.toBeNull());
  });

  it('shows the title-matching session and switches on click', async () => {
    render(<SpotlightPalette />);
    open();
    const row = await screen.findByTestId('search-palette-session-row-c1');
    await userEvent.click(row);
    expect(mockSwitch).toHaveBeenCalledWith('c1');
    expect(useOverlaysStore.getState().paletteOpen).toBe(false);
  });

  it('# mode shows a mode chip and a change row', async () => {
    render(<SpotlightPalette />);
    open();
    const input = await screen.findByTestId('search-palette-input');
    await userEvent.type(input, '#');
    expect(await screen.findByTestId('search-palette-mode-chip')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('search-palette-change-row-src/a.ts')).not.toBeNull());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/SpotlightPalette.test.tsx`
Expected: FAIL — cannot resolve `../SpotlightPalette`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/app-tauri/src/features/palette/SpotlightPalette.tsx
/**
 * SpotlightPalette — the ⌘O four-mode command palette.
 * Modes by prefix: (none) files+sessions · ">" commands · "@" symbols · "#" changes.
 * Open-state via useOverlaysStore.paletteOpen (set by the intent subscriber on
 * 'open-search-palette'). Custom engine (no cmdk): mode parsing + useListNavigation.
 */
import { useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useOverlaysStore } from '@/store/overlays';
import { useListNavigation } from '@/lib/ui/use-list-navigation';
import { threadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { parseQuery } from './palette-modes';
import { useSpotlightResults, type SpotlightRow } from './use-spotlight-results';
import { SpotlightRowView } from './SpotlightRow';

const FOOTER_HINTS = [
  ['↑↓', 'Navigate'],
  ['⏎', 'Open'],
  ['esc', 'Dismiss'],
] as const;

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const parsed = parseQuery(query);

  const runtime = useAssistantRuntime();
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const sessions = threadItemsToSessionItems(threadItems);
  const port = useDaemonPort();
  const { projectId, projectPath, chatId } = useActiveIdentity();

  const { rows, loading } = useSpotlightResults({
    parsed,
    port,
    projectId,
    projectPath,
    chatId,
    sessions,
    switchToThread: (id) => runtime.threads.switchToThread(id),
  });

  const confirm = (row: SpotlightRow) => {
    row.run();
    onClose();
  };
  const { activeIndex, handleKeyDown, rowRefs } = useListNavigation(rows.length, (i) => {
    const row = rows[i];
    if (row) confirm(row);
  });

  const sectionLabel =
    parsed.mode === 'cmd'
      ? 'Commands'
      : parsed.mode === 'sym'
        ? 'Symbols'
        : parsed.mode === 'chg'
          ? 'Working tree'
          : parsed.term
            ? 'Results'
            : 'Sessions';

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Field */}
      <div className="flex h-[54px] shrink-0 items-center gap-[11px] border-b border-border px-[16px]">
        <SearchIcon className="size-4 shrink-0 text-mf-text-3" />
        {parsed.chip && (
          <span
            data-testid="search-palette-mode-chip"
            className="inline-flex h-[22px] shrink-0 items-center rounded-[6px] bg-accent/10 px-[9px] text-caption font-bold text-accent"
          >
            {parsed.chip}
          </span>
        )}
        <input
          autoFocus
          data-testid="search-palette-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={parsed.placeholder}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-heading tracking-tight text-foreground outline-none placeholder:text-mf-text-3"
        />
        <kbd className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[6px] bg-mf-chip px-[6px] text-caption font-semibold text-mf-text-3">
          esc
        </kbd>
      </div>

      {/* Results */}
      <div role="listbox" className="flex-1 overflow-y-auto overflow-x-hidden p-[6px]">
        <div className="px-[10px] pb-[4px] pt-[6px] text-micro font-bold uppercase tracking-wide text-mf-text-3">
          {sectionLabel}
        </div>
        {rows.length === 0 && !loading && (
          <div data-testid="search-palette-empty" className="px-[10px] py-[26px] text-center text-body text-mf-text-3">
            No matches
          </div>
        )}
        {rows.map((row, i) => (
          <SpotlightRowView
            key={row.id}
            row={row}
            isActive={i === activeIndex}
            rowRef={(el) => {
              rowRefs.current[i] = el;
            }}
            onSelect={confirm}
          />
        ))}
      </div>

      {/* Footer */}
      <div
        data-testid="search-palette-footer"
        className="flex h-[34px] shrink-0 items-center gap-[16px] border-t border-border bg-mf-content2 px-[14px]"
      >
        {FOOTER_HINTS.map(([k, l]) => (
          <span key={l} className="inline-flex items-center gap-[5px]">
            <kbd className="inline-flex h-4 items-center rounded-[4px] bg-mf-chip px-[5px] text-micro font-semibold text-mf-text-3">
              {k}
            </kbd>
            <span className="text-caption text-mf-text-3">{l}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function SpotlightPalette() {
  const open = useOverlaysStore((s) => s.paletteOpen);
  const setPaletteOpen = useOverlaysStore((s) => s.setPaletteOpen);
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && setPaletteOpen(false)}>
      <DialogContent
        data-testid="search-palette"
        hideClose
        aria-describedby={undefined}
        className="top-[11vh] w-[580px] max-w-[90vw] translate-y-0 gap-0 overflow-hidden rounded-[13px] border-0 p-0 shadow-[0_32px_80px_rgba(0,0,0,0.34),0_0_0_0.5px_rgba(0,0,0,0.16)] max-h-[62vh]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <PaletteBody onClose={() => setPaletteOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/SpotlightPalette.test.tsx`
Expected: PASS (3 tests).
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/features/palette/SpotlightPalette.tsx packages/app-tauri/src/features/palette/__tests__/SpotlightPalette.test.tsx
git commit -m "feat(app-tauri): SpotlightPalette shell (four-mode ⌘O palette)"
```

---

### Task 11: Mount swap + remove the old SearchPalette

**Files:**
- Modify: `packages/app-tauri/src/app/AppShell.tsx` (swap the import + element)
- Delete: `packages/app-tauri/src/components/overlays/SearchPalette.tsx`
- Delete: `packages/app-tauri/src/components/overlays/__tests__/SearchPalette.test.tsx`
- Modify: `packages/app-tauri/docs/architecture/MIGRATION-TRACKER.md` (mark the ⌘O spotlight done)

**Interfaces:**
- Consumes: `SpotlightPalette` (Task 10).

- [ ] **Step 1: Swap the AppShell mount**

In `packages/app-tauri/src/app/AppShell.tsx`, replace line 16:

```ts
import { SearchPalette } from '../components/overlays/SearchPalette';
```

with:

```ts
import { SpotlightPalette } from '../features/palette/SpotlightPalette';
```

and replace `<SearchPalette />` (line ~156) with `<SpotlightPalette />`.

- [ ] **Step 2: Delete the obsolete component + its test**

```bash
git rm packages/app-tauri/src/components/overlays/SearchPalette.tsx packages/app-tauri/src/components/overlays/__tests__/SearchPalette.test.tsx
```

- [ ] **Step 3: Verify nothing else imports the old path**

Run: `grep -rn "overlays/SearchPalette" packages/app-tauri/src`
Expected: no output (only the now-deleted files referenced it).

- [ ] **Step 4: Typecheck + run the full palette suite set individually**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.
Run each (individually, per the React.act constraint):
```
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/lsp/__tests__/symbol-kind.test.ts
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/lsp/__tests__/workspace-symbols.test.ts
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/store/__tests__/intent-subscriber.commands.test.ts
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/palette-modes.test.ts
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/palette-commands.test.ts
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/lib/ui/__tests__/use-list-navigation.test.tsx
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/use-workspace-symbols.test.tsx
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/use-spotlight-results.test.tsx
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/SpotlightRow.test.tsx
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/palette/__tests__/SpotlightPalette.test.tsx
pnpm --filter @qlan-ro/mainframe-app-tauri exec vitest run src/features/files/__tests__/FilePickerDialog.test.tsx
```
Expected: all PASS.

- [ ] **Step 5: Update the tracker + changeset + commit**

Update the relevant ⌘O palette row in `packages/app-tauri/docs/architecture/MIGRATION-TRACKER.md` to "done — four-mode spotlight (files+sessions · `>` commands · `@` symbols · `#` changes)".

```bash
pnpm changeset   # pick @qlan-ro/mainframe-app-tauri, minor; summary: "⌘O four-mode spotlight palette"
git add packages/app-tauri/src/app/AppShell.tsx packages/app-tauri/docs/architecture/MIGRATION-TRACKER.md .changeset
git commit -m "feat(app-tauri): mount SpotlightPalette, retire the two-group SearchPalette"
```

---

## Manual verification (after all tasks)

Live-render check via the `@hypothesi` tauri-mcp (dev daemon on 31500; stop any running sandbox preview first, or the `main` window lookup fails):
1. ⌘O opens the palette; default mode lists Sessions; typing ≥2 chars adds file rows.
2. `>` shows the Commands chip + the six commands; ⏎ on "Open Settings…" opens settings.
3. `@Name` lists workspace symbols (open a `.ts` editor tab first so the language resolves to typescript); ⏎ opens the file at the symbol line.
4. `#` lists working-tree changes with status badges; ⏎ opens the diff.
5. Visual: 13px radius, no border, inline `esc` chip (no duplicate X), 40px rows with the warm accent tint, footer bar. Cross-check px against `06-palette.jsx` (compressed-spacing trap).

---

## Self-Review

**1. Spec coverage:**
- Four modes → Tasks 4 (parse), 5 (cmd), 7 (sym), 8 (file/chg aggregation). ✓
- Real-LSP `@` symbols, no core change → Tasks 1–2, 7. ✓
- `#` status-only → Task 8 (`useGitChanges` + `KIND_LABEL`). ✓
- `>` via intents (no reach-through) → Tasks 3, 5. ✓
- Sessions kept, filtered + capped → Task 8. ✓
- Drop cmdk / custom engine / remove dup X → Tasks 6, 9, 10 (`Dialog` + `hideClose`), 11. ✓
- `shouldFilter` defect fixed → Task 8 (we own filtering; file results not re-filtered; asserted in test). ✓
- Visual parity → Tasks 9–10 (artboard px + tokens). ✓
- data-testids → Tasks 8 (ids) + 9/10 (render). ✓
- Side effects (intents, lsp method, lifted hook, mount move) → Tasks 3, 2, 6, 11. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete. ✓

**3. Type consistency:** `LspSymbol {name,kind,path,line}` (Task 2) consumed unchanged in Tasks 7–8. `SpotlightRow` (Task 8) consumed in Task 9/10. `getWorkspaceSymbols(projectId, language, query)` signature identical across Tasks 2/7. `parseQuery → {mode,term,chip,placeholder}` consistent across Tasks 4/8/10. ✓
