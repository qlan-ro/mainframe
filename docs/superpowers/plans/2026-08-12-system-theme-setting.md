# System Theme Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a System appearance preference that defaults to and follows the operating system's live color scheme.

**Architecture:** Keep the persisted preference (`system | light | dark`) separate from the resolved appearance (`light | dark`) in the Zustand theme store. Resolve System synchronously during startup, then let `ThemeEffect` subscribe to the color-scheme media query and update concrete-theme consumers through `resolvedMode`.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Testing Library, CodeMirror 6

## Global Constraints

- Missing or invalid `mf-theme` values default to `system`.
- System resolves through `window.matchMedia('(prefers-color-scheme: dark)')`; unavailable media-query support falls back to Light.
- Existing stored `light` and `dark` values retain fixed behavior.
- Settings shows System, Light, and Dark in that order.
- The toolbar button selects the opposite fixed theme based on the resolved appearance.
- Every new interactive element has a kebab-case `data-testid`.
- Add no dependency or daemon setting.

---

### Task 1: Model and synchronize the system theme

**Files:**
- Modify: `packages/ui/src/store/theme.ts`
- Modify: `packages/ui/src/store/__tests__/theme.test.ts`
- Modify: `packages/ui/src/app/ThemeEffect.tsx`
- Modify: `packages/ui/src/app/__tests__/ThemeEffect.test.tsx`

**Interfaces:**
- Produces: `ThemeMode = 'system' | 'light' | 'dark'`
- Produces: `ResolvedThemeMode = 'light' | 'dark'`
- Produces: theme state fields `mode: ThemeMode` and `resolvedMode: ResolvedThemeMode`
- Produces: `syncSystemMode(matchesDark: boolean): void`
- Preserves: `setMode(mode: ThemeMode): void`, `toggle(): void`, `applyStoredTheme(): void`

- [ ] **Step 1: Add failing store tests for preference resolution**

Add a controllable `matchMedia` stub and assertions that missing/invalid storage defaults to System, stored System persists, startup follows both OS states, fixed modes ignore OS resolution, and `toggle()` uses `resolvedMode`:

```ts
function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches })),
  });
}

it('defaults to system and resolves the current operating-system theme', async () => {
  installMatchMedia(true);
  const { useTheme } = await import('../theme');
  expect(useTheme.getState()).toMatchObject({ mode: 'system', resolvedMode: 'dark' });
});

it('ignores operating-system changes while a fixed mode is selected', async () => {
  const { useTheme } = await import('../theme');
  useTheme.getState().setMode('light');
  useTheme.getState().syncSystemMode(true);
  expect(useTheme.getState().resolvedMode).toBe('light');
});
```

- [ ] **Step 2: Run the store test and verify the new assertions fail**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/store/__tests__/theme.test.ts`

Expected: FAIL because `system`, `resolvedMode`, and `syncSystemMode` do not exist.

- [ ] **Step 3: Implement preference and resolved appearance in the store**

Use one media-query constant and resolve the preference at every state boundary:

```ts
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';
const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

function readSystemMode(): ResolvedThemeMode {
  try {
    return window.matchMedia?.(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function resolveMode(mode: ThemeMode): ResolvedThemeMode {
  return mode === 'system' ? readSystemMode() : mode;
}
```

Initialize `mode` and `resolvedMode` from one stored preference. Make `setMode` persist and set both values, make `syncSystemMode` conditional on `mode === 'system'`, make `toggle` compare `resolvedMode`, and make `applyStoredTheme` call `resolveMode(readMode())`.

- [ ] **Step 4: Run the store test and verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/store/__tests__/theme.test.ts`

Expected: PASS with the new System preference cases and the existing UI-scale cases.

- [ ] **Step 5: Add failing runtime synchronization tests**

In `ThemeEffect.test.tsx`, install a complete media-query stub that captures its change listener:

```ts
let colorSchemeListener: ((event: MediaQueryListEvent) => void) | undefined;
const removeEventListener = vi.fn();

window.matchMedia = vi.fn(() => ({
  matches: false,
  media: '(prefers-color-scheme: dark)',
  onchange: null,
  addEventListener: vi.fn((_type, listener) => {
    colorSchemeListener = listener as (event: MediaQueryListEvent) => void;
  }),
  removeEventListener,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
```

Assert that a change event updates `resolvedMode` and `.dark` in System mode, fixed mode ignores it, and unmount calls `removeEventListener` with the registered listener.

- [ ] **Step 6: Run the effect test and verify the new assertions fail**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/app/__tests__/ThemeEffect.test.tsx`

Expected: FAIL because `ThemeEffect` has no media-query subscription and still reads `mode` as a concrete appearance.

- [ ] **Step 7: Implement the runtime media-query subscription**

Drive the root class and Shiki invalidation from `resolvedMode`. Add a mount-only effect that performs an initial synchronization, subscribes to `change`, and removes the same listener:

```ts
useEffect(() => {
  if (typeof window.matchMedia !== 'function') return;
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = (matchesDark: boolean) => useTheme.getState().syncSystemMode(matchesDark);
  const onChange = (event: MediaQueryListEvent) => sync(event.matches);
  sync(mediaQuery.matches);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}, []);
```

- [ ] **Step 8: Run both focused tests and commit Task 1**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/store/__tests__/theme.test.ts src/app/__tests__/ThemeEffect.test.tsx`

Expected: PASS.

```bash
git add packages/ui/src/store/theme.ts packages/ui/src/store/__tests__/theme.test.ts packages/ui/src/app/ThemeEffect.tsx packages/ui/src/app/__tests__/ThemeEffect.test.tsx
git commit -m "feat(ui): follow the system color scheme"
```

### Task 2: Expose System and migrate concrete-theme consumers

**Files:**
- Modify: `packages/ui/src/features/settings/panes/general/AppearanceControls.tsx`
- Modify: `packages/ui/src/features/settings/panes/general/__tests__/GeneralPane.test.tsx`
- Modify: `packages/ui/src/layout/MainToolbar.tsx`
- Modify: `packages/ui/src/layout/__tests__/MainToolbar.test.tsx`
- Modify: `packages/ui/src/features/editor/CmEditor.tsx`
- Modify: `packages/ui/src/features/editor/CmDiffEditor.tsx`
- Modify: `packages/ui/src/features/editor/__tests__/CmEditor.test.tsx`
- Modify: `packages/ui/src/features/editor/__tests__/CmDiffEditor.test.tsx`
- Modify: `.changeset/fifty-hoops-attack.md`
- Add: `docs/superpowers/plans/2026-08-12-system-theme-setting.md` (force-add because `docs/superpowers/` is ignored)

**Interfaces:**
- Consumes: `mode: ThemeMode` for the Settings selection
- Consumes: `resolvedMode: ResolvedThemeMode` for the toolbar and CodeMirror dark flag
- Consumes: `toggle(): void`, which leaves System by selecting the opposite fixed mode

- [ ] **Step 1: Add failing Settings and toolbar tests**

Add these behavior checks:

```ts
it('selecting System writes useTheme without any PUT', () => {
  useTheme.setState({ mode: 'light', resolvedMode: 'light' });
  render(<GeneralPane port={31415} />);
  fireEvent.click(screen.getByTestId('settings-appearance-mode-system'));
  expect(useTheme.getState().mode).toBe('system');
  expect(updateGeneralSettings).not.toHaveBeenCalled();
});

it('uses the resolved System appearance for the quick override', () => {
  useTheme.setState({ mode: 'system', resolvedMode: 'dark' });
  renderToolbar();
  fireEvent.click(screen.getByTestId('main-toolbar-theme'));
  expect(useTheme.getState()).toMatchObject({ mode: 'light', resolvedMode: 'light' });
});
```

- [ ] **Step 2: Run the Settings and toolbar tests and verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/settings/panes/general/__tests__/GeneralPane.test.tsx src/layout/__tests__/MainToolbar.test.tsx`

Expected: FAIL because the System control is absent and the toolbar reads the preference instead of `resolvedMode`.

- [ ] **Step 3: Add the System option and update the toolbar**

Prepend the option without changing the existing picker:

```ts
const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];
```

In `MainToolbar`, select `resolvedMode` and derive `isDark` from it. Keep `toggle` as the button action.

- [ ] **Step 4: Run the Settings and toolbar tests and verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/settings/panes/general/__tests__/GeneralPane.test.tsx src/layout/__tests__/MainToolbar.test.tsx`

Expected: PASS.

- [ ] **Step 5: Add failing CodeMirror tests for resolved System changes**

Update the standalone editor hot-swap test to keep `mode: 'system'` while changing only `resolvedMode`. Add the equivalent assertion for both `CmDiffEditor` panes:

```ts
act(() => useTheme.setState({ mode: 'system', resolvedMode: 'light' }));
// render editor, assert EditorView.darkTheme is false
act(() => useTheme.setState({ resolvedMode: 'dark' }));
// assert EditorView.darkTheme is true while mode remains system
```

- [ ] **Step 6: Run the editor tests and verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/editor/__tests__/CmEditor.test.tsx src/features/editor/__tests__/CmDiffEditor.test.tsx`

Expected: FAIL because both components subscribe to `mode`.

- [ ] **Step 7: Migrate CodeMirror consumers to `resolvedMode`**

In both editors, replace `mode` subscriptions and mount-time store reads with `resolvedMode`. Build `makeWarmTheme(resolvedMode === 'dark')` and depend on `resolvedMode` in the reconfiguration effects.

- [ ] **Step 8: Update the UI package changeset**

Replace the empty changeset with:

```md
---
'@qlan-ro/mainframe-ui': minor
---

Add a System appearance setting that follows live operating-system theme changes.
```

- [ ] **Step 9: Run focused regression tests and typecheck**

Run:

```bash
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/store/__tests__/theme.test.ts src/app/__tests__/ThemeEffect.test.tsx src/features/settings/panes/general/__tests__/GeneralPane.test.tsx src/layout/__tests__/MainToolbar.test.tsx src/features/editor/__tests__/CmEditor.test.tsx src/features/editor/__tests__/CmDiffEditor.test.tsx
pnpm --filter @qlan-ro/mainframe-ui typecheck
git diff --check
```

Expected: all focused tests pass, TypeScript exits 0, and the diff check reports no errors.

- [ ] **Step 10: Commit Task 2**

```bash
git add packages/ui/src/features/settings/panes/general/AppearanceControls.tsx packages/ui/src/features/settings/panes/general/__tests__/GeneralPane.test.tsx packages/ui/src/layout/MainToolbar.tsx packages/ui/src/layout/__tests__/MainToolbar.test.tsx packages/ui/src/features/editor/CmEditor.tsx packages/ui/src/features/editor/CmDiffEditor.tsx packages/ui/src/features/editor/__tests__/CmEditor.test.tsx packages/ui/src/features/editor/__tests__/CmDiffEditor.test.tsx .changeset/fifty-hoops-attack.md
git add -f docs/superpowers/plans/2026-08-12-system-theme-setting.md
git commit -m "feat(ui): expose system theme preference"
```
