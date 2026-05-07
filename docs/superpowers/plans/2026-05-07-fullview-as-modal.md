# Fullview Plugin Zone as Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the `'fullview'` plugin zone as an overlay modal (like `ReviewPanel`) instead of taking over the center area of the app.

**Architecture:** Add a new `FullviewModal` component that reads `activeFullviewId` from the existing plugin store and renders the active plugin's component inside a centered overlay card. Mount it at the app root next to `ReviewPanel`. Remove the center-area takeover branch in `Layout.tsx`. Store, registration, and `LeftRail` toggle behavior stay unchanged.

**Tech Stack:** React, TypeScript, Zustand, Tailwind, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-07-fullview-as-modal-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/desktop/src/renderer/components/modals/FullviewModal.tsx` | **Create** | Overlay modal shell — backdrop, centered card, header (uppercase label + X), body renders `<PluginView />` |
| `packages/desktop/src/renderer/components/modals/FullviewModal.integration.test.tsx` | **Create** | Vitest integration tests |
| `packages/desktop/src/renderer/components/modals/index.ts` | **Modify** | Export `FullviewModal` |
| `packages/desktop/src/renderer/App.tsx` | **Modify** | Mount `<FullviewModal />` next to existing global components |
| `packages/desktop/src/renderer/components/Layout.tsx` | **Modify** | Remove `activeFullviewId` conditional (lines ~115-119) |

---

## Task 1: Write failing integration tests for `FullviewModal`

**Files:**
- Test: `packages/desktop/src/renderer/components/modals/FullviewModal.integration.test.tsx`

- [ ] **Step 1: Create the test file**

Create `packages/desktop/src/renderer/components/modals/FullviewModal.integration.test.tsx`:

```tsx
import React from 'react';
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FullviewModal } from './FullviewModal';
import { usePluginLayoutStore } from '../../store/plugins';
import type { PluginUIContribution } from '@qlan-ro/mainframe-types';

// PluginView mounts real plugin React trees (TodosPanel etc.) which pull in
// daemon clients and other heavy modules. The modal's behaviour is what we
// test here — plugin rendering is covered elsewhere.
vi.mock('../plugins/PluginView', () => ({
  PluginView: ({ pluginId }: { pluginId: string }) => (
    <div data-testid="plugin-view">{pluginId}</div>
  ),
}));

function makeContribution(pluginId: string, label: string): PluginUIContribution {
  return {
    pluginId,
    panelId: 'panel-1',
    zone: 'fullview',
    label,
    icon: undefined,
  };
}

function resetStore(): void {
  usePluginLayoutStore.setState({
    contributions: [],
    actions: [],
    triggeredAction: null,
    activeFullviewId: null,
  });
}

describe('FullviewModal Integration', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders nothing when no fullview is active', () => {
    const { container } = render(<FullviewModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the plugin and uppercased label when activated', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    expect(screen.getByTestId('plugin-view')).toHaveTextContent('todos');

    const heading = screen.getByText('Todos');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('closes when the X button is clicked', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    fireEvent.click(screen.getByLabelText('Close'));

    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });

  it('closes when the backdrop is clicked', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    fireEvent.click(screen.getByTestId('fullview-modal-backdrop'));

    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });

  it('does not close when clicking inside the card', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    fireEvent.click(screen.getByTestId('plugin-view'));

    expect(usePluginLayoutStore.getState().activeFullviewId).toBe('todos');
  });

  it('closes when Escape is pressed', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });

  it('falls back to pluginId in header when no contribution label is found', () => {
    usePluginLayoutStore.setState({
      contributions: [],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);
    expect(screen.getByText('todos')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- FullviewModal.integration`
Expected: FAIL — module `./FullviewModal` does not exist.

---

## Task 2: Implement `FullviewModal`

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/FullviewModal.tsx`

- [ ] **Step 1: Create `FullviewModal.tsx`**

Create `packages/desktop/src/renderer/components/modals/FullviewModal.tsx`:

```tsx
import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { PluginView } from '../plugins/PluginView';
import { usePluginLayoutStore } from '../../store/plugins';

export const FullviewModal: React.FC = () => {
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
  const contributions = usePluginLayoutStore((s) => s.contributions);
  const activateFullview = usePluginLayoutStore((s) => s.activateFullview);

  const close = (): void => {
    if (activeFullviewId) {
      activateFullview(activeFullviewId);
    }
  };

  useEffect(() => {
    if (!activeFullviewId) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFullviewId]);

  if (!activeFullviewId) return null;

  const contribution = contributions.find(
    (c) => c.pluginId === activeFullviewId && c.zone === 'fullview',
  );
  const label = contribution?.label ?? activeFullviewId;

  return (
    <div
      data-testid="fullview-modal-backdrop"
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-mf-overlay/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-5/6 w-5/6 flex-col rounded-lg border border-mf-border bg-mf-app-bg shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-mf-border px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-mf-text-secondary">
            {label}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={close}
            aria-label="Close"
            className="hover:bg-mf-hover"
          >
            <X size={14} />
          </Button>
        </div>

        <div className="flex-1 overflow-hidden">
          <PluginView pluginId={activeFullviewId} />
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- FullviewModal.integration`
Expected: PASS — all 7 tests green.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/FullviewModal.tsx \
        packages/desktop/src/renderer/components/modals/FullviewModal.integration.test.tsx
git commit -m "feat(desktop): add FullviewModal for plugin fullview zone"
```

---

## Task 3: Export `FullviewModal` from modals barrel

**Files:**
- Modify: `packages/desktop/src/renderer/components/modals/index.ts`

- [ ] **Step 1: Add the export**

Edit `packages/desktop/src/renderer/components/modals/index.ts`. Current content:

```ts
export { ReviewPanel } from './ReviewPanel';
export { ReviewPanelHeader } from './ReviewPanelHeader';
export { FileTree } from './FileTree';
export { DiffView } from './DiffView';
```

Add a line so the file becomes:

```ts
export { ReviewPanel } from './ReviewPanel';
export { ReviewPanelHeader } from './ReviewPanelHeader';
export { FileTree } from './FileTree';
export { DiffView } from './DiffView';
export { FullviewModal } from './FullviewModal';
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/index.ts
git commit -m "feat(desktop): export FullviewModal from modals barrel"
```

---

## Task 4: Mount `FullviewModal` in `App.tsx`

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Import `FullviewModal`**

Edit `packages/desktop/src/renderer/App.tsx`. Locate the import block at the top (lines 1-17). Add this import after the existing component imports (e.g. after line 17):

```ts
import { FullviewModal } from './components/modals';
```

- [ ] **Step 2: Render the modal**

Find the JSX returned from `App` (lines 65-77). Insert `<FullviewModal />` inside the `<TooltipProvider>`, after `<Layout … />` and before `<SearchPalette />`. The block becomes:

```tsx
  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={200} skipDelayDuration={100} disableHoverableContent>
        <Layout centerPanel={<CenterPanel />} />
        <FullviewModal />
        <SearchPalette />
        <SettingsModal />
        <TutorialOverlay />
        <ConnectionOverlay />
        <Toaster />
        <PluginGlobalComponents />
      </TooltipProvider>
    </ErrorBoundary>
  );
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): mount FullviewModal at app root"
```

---

## Task 5: Remove fullview branch from `Layout.tsx`

**Files:**
- Modify: `packages/desktop/src/renderer/components/Layout.tsx` (lines ~84, 115-119)

- [ ] **Step 1: Inspect the current branch**

Read `packages/desktop/src/renderer/components/Layout.tsx`. The relevant section currently looks like:

```tsx
export function Layout({ centerPanel }: LayoutProps): React.ReactElement {
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
  // ...

          <div className="flex-1 flex flex-col overflow-hidden pb-mf-gap">
            {activeFullviewId ? (
              <div className="flex-1 bg-mf-panel-bg rounded-mf-panel overflow-hidden">
                <PluginView pluginId={activeFullviewId} />
              </div>
            ) : (
              <>
                {/* Upper area: horizontal Group with left col + center + right col */}
                <Group orientation="horizontal" className="flex-1">
                  ...
                </Group>
                ...
              </>
            )}
          </div>
```

- [ ] **Step 2: Delete the `activeFullviewId` line**

Remove this line (currently around line 84):

```tsx
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
```

- [ ] **Step 3: Unwrap the conditional**

Replace the `{activeFullviewId ? (...) : (<>...</>)}` block with the contents of the false branch (the existing `<Group …>` plus everything after it that was inside the fragment). Keep the wrapping `<div className="flex-1 flex flex-col overflow-hidden pb-mf-gap">`.

After the edit, the section looks like:

```tsx
          <div className="flex-1 flex flex-col overflow-hidden pb-mf-gap">
            {/* Upper area: horizontal Group with left col + center + right col */}
            <Group orientation="horizontal" className="flex-1">
              ...
            </Group>
            ...
          </div>
```

- [ ] **Step 4: Remove now-unused imports**

If `PluginView` is no longer referenced anywhere in `Layout.tsx`, delete its import (search the file for `PluginView` to confirm). If `usePluginLayoutStore` is no longer referenced, remove it too. Run:

```bash
pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit
```

Expected: no errors. The TS6133 / no-unused-vars rule will surface anything you missed.

- [ ] **Step 5: Smoke-test the UI manually**

Start the dev server (`pnpm dev` from the repo root or whichever script you use locally). Verify:

1. App loads with the normal layout visible.
2. Click the Todos icon in the LeftRail → modal overlay appears with `TODOS` (uppercase) label and X button. Underlying layout still visible behind the dimmed backdrop.
3. Click the X → modal closes, layout unchanged.
4. Re-open, press Escape → modal closes.
5. Re-open, click backdrop (outside the card) → modal closes.
6. Re-open, click inside the card / on a TODO → modal stays open.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/Layout.tsx
git commit -m "refactor(desktop): remove fullview takeover from Layout (now rendered as modal)"
```

---

## Task 6: Add a changeset

**Files:**
- Create: `.changeset/fullview-as-modal.md` (filename will differ — `pnpm changeset` generates it)

- [ ] **Step 1: Run `pnpm changeset`**

Run: `pnpm changeset`

Select `@qlan-ro/mainframe-desktop` with bump type **patch** (UI behaviour change, no API surface change).

Summary line:
```
Render fullview plugin zone as an overlay modal instead of replacing the center layout.
```

- [ ] **Step 2: Commit the changeset**

```bash
git add .changeset/
git commit -m "chore: changeset for fullview-as-modal"
```

---

## Task 7: Run full test suite + typecheck

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm build`
Expected: all packages build with no TS errors.

- [ ] **Step 2: Run desktop tests**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test`
Expected: all tests pass, including the new `FullviewModal.integration` suite and the existing `plugins.test.ts` (which is untouched and should still pass — store contract unchanged).

If `plugins.test.ts` references `activeFullviewId` behavior that is intact, no edits are needed. If it fails, re-read the test and reconcile against the unchanged store — do **not** modify the store.

- [ ] **Step 3: If everything is green, you're done.**

The branch should now contain:
- 1 new component file
- 1 new test file
- 4 modified files (`modals/index.ts`, `App.tsx`, `Layout.tsx`, plus the changeset)
- 5 commits

---

## Self-Review Checklist (already run by author)

- **Spec coverage:** Every section of the spec maps to a task — `FullviewModal` (Task 2), barrel export (Task 3), App mount (Task 4), Layout cleanup (Task 5), tests (Task 1), changeset (Task 6). ✓
- **Placeholders:** None. Every step contains exact code or commands. ✓
- **Type consistency:** `activeFullviewId`, `activateFullview`, `contributions`, `PluginUIContribution.label/zone/pluginId/panelId` all match `store/plugins.ts` and `@qlan-ro/mainframe-types`. ✓
- **Unchanged surfaces:** `LeftRail`, store, `UIZone`, `TodosPanel`, `PluginView` — no changes proposed, matches spec "Unchanged" list. ✓
