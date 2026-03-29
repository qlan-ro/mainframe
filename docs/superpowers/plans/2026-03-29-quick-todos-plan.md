# Quick Todos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Cmd+T` shortcut that opens a minimal quick-create dialog for tasks, powered by a new plugin action API.

**Architecture:** Extend the plugin UI context with `addAction`/`removeAction` methods. The daemon emits action registration events over WebSocket. The desktop stores registered actions, listens for keyboard shortcuts (with app-shortcut priority), and sets a trigger that plugin UI components consume. The todos plugin registers a `quick-create` action and renders a `QuickTodoDialog`.

**Tech Stack:** TypeScript, React, Zustand, Express, pino

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/types/src/plugin.ts` | Add `PluginAction` interface, extend `PluginUIContext` |
| Modify | `packages/types/src/events.ts` | Add `plugin.action.registered` / `plugin.action.unregistered` events |
| Modify | `packages/types/src/index.ts` | Export `PluginAction` |
| Modify | `packages/core/src/plugins/ui-context.ts` | Implement `addAction` / `removeAction` |
| Modify | `packages/core/src/plugins/manager.ts` | Track action events, expose in listing + replay |
| Modify | `packages/core/src/plugins/builtin/todos/index.ts` | Register `quick-create` action |
| Modify | `packages/desktop/src/renderer/store/plugins.ts` | Add `actions`, `triggeredAction`, action methods |
| Modify | `packages/desktop/src/renderer/lib/api/plugins-api.ts` | Add `actions` to `PluginInfo` |
| Modify | `packages/desktop/src/renderer/hooks/useAppInit.ts` | Load actions from plugin listing on init |
| Modify | `packages/desktop/src/renderer/lib/ws-event-router.ts` | Route action events to store |
| Create | `packages/desktop/src/renderer/hooks/usePluginShortcuts.ts` | Global keydown listener for plugin actions |
| Modify | `packages/desktop/src/renderer/App.tsx` | Mount `usePluginShortcuts` hook and `PluginGlobalComponents` |
| Create | `packages/desktop/src/renderer/components/plugins/PluginGlobalComponents.tsx` | Renders always-mounted plugin components |
| Create | `packages/desktop/src/renderer/components/todos/QuickTodoDialog.tsx` | The quick-create dialog |
| Create | `packages/core/src/__tests__/plugins/ui-context.test.ts` | Tests for addAction/removeAction |
| Create | `packages/desktop/src/renderer/components/todos/__tests__/QuickTodoDialog.test.tsx` | Tests for the dialog |

---

### Task 1: Add `PluginAction` type and extend `PluginUIContext`

**Files:**
- Modify: `packages/types/src/plugin.ts:137-141` (PluginUIContext)
- Modify: `packages/types/src/index.ts:14-37` (exports)

- [ ] **Step 1: Add `PluginAction` interface to `packages/types/src/plugin.ts`**

Add after the `PluginUIContribution` interface (after line 29):

```ts
export interface PluginAction {
  id: string;
  pluginId: string;
  label: string;
  shortcut: string;
  icon?: string;
}
```

- [ ] **Step 2: Extend `PluginUIContext` with action methods**

In `packages/types/src/plugin.ts`, update the `PluginUIContext` interface (lines 137-141) from:

```ts
export interface PluginUIContext {
  addPanel(opts: { zone: UIZone; label: string; icon?: string }): void;
  removePanel(): void;
  notify(options: { title: string; body: string; level?: 'info' | 'warning' | 'error' }): void;
}
```

to:

```ts
export interface PluginUIContext {
  addPanel(opts: { zone: UIZone; label: string; icon?: string }): void;
  removePanel(): void;
  addAction(opts: { id: string; label: string; shortcut: string; icon?: string }): void;
  removeAction(id: string): void;
  notify(options: { title: string; body: string; level?: 'info' | 'warning' | 'error' }): void;
}
```

- [ ] **Step 3: Export `PluginAction` from `packages/types/src/index.ts`**

Add `PluginAction` to the named exports from `./plugin.js` (line 14-37):

```ts
export type {
  PluginAction,
  PluginCapability,
  // ... rest unchanged
} from './plugin.js';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: Success (types only — no implementation yet, but the types package should compile)

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/plugin.ts packages/types/src/index.ts
git commit -m "feat(types): add PluginAction interface and extend PluginUIContext"
```

---

### Task 2: Add action daemon events

**Files:**
- Modify: `packages/types/src/events.ts:7-37` (DaemonEvent union)

- [ ] **Step 1: Add action events to `DaemonEvent`**

In `packages/types/src/events.ts`, add two new union members after the `plugin.panel.unregistered` line (after line 30):

```ts
  | {
      type: 'plugin.action.registered';
      pluginId: string;
      actionId: string;
      label: string;
      shortcut: string;
      icon?: string;
    }
  | { type: 'plugin.action.unregistered'; pluginId: string; actionId: string }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/events.ts
git commit -m "feat(types): add plugin.action.registered/unregistered daemon events"
```

---

### Task 3: Implement `addAction`/`removeAction` in ui-context

**Files:**
- Modify: `packages/core/src/plugins/ui-context.ts`
- Create: `packages/core/src/__tests__/plugins/ui-context.test.ts`

- [ ] **Step 1: Write failing tests for `addAction` and `removeAction`**

Create `packages/core/src/__tests__/plugins/ui-context.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPluginUIContext } from '../../plugins/ui-context.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

describe('createPluginUIContext', () => {
  it('addAction emits plugin.action.registered event', () => {
    const emitEvent = vi.fn<(event: DaemonEvent) => void>();
    const ui = createPluginUIContext('todos', emitEvent);

    ui.addAction({ id: 'quick-create', label: 'New Task', shortcut: 'mod+t', icon: 'plus' });

    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.action.registered',
      pluginId: 'todos',
      actionId: 'quick-create',
      label: 'New Task',
      shortcut: 'mod+t',
      icon: 'plus',
    });
  });

  it('removeAction emits plugin.action.unregistered event', () => {
    const emitEvent = vi.fn<(event: DaemonEvent) => void>();
    const ui = createPluginUIContext('todos', emitEvent);

    ui.removeAction('quick-create');

    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.action.unregistered',
      pluginId: 'todos',
      actionId: 'quick-create',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/plugins/ui-context.test.ts`
Expected: FAIL — `addAction` and `removeAction` are not implemented yet

- [ ] **Step 3: Implement `addAction` and `removeAction`**

Update `packages/core/src/plugins/ui-context.ts` to:

```ts
import type { PluginUIContext, UIZone, DaemonEvent } from '@qlan-ro/mainframe-types';

export function createPluginUIContext(pluginId: string, emitEvent: (event: DaemonEvent) => void): PluginUIContext {
  return {
    addPanel({ zone, label, icon }: { zone: UIZone; label: string; icon?: string }): void {
      emitEvent({
        type: 'plugin.panel.registered',
        pluginId,
        zone,
        label,
        icon,
      });
    },

    removePanel(): void {
      emitEvent({
        type: 'plugin.panel.unregistered',
        pluginId,
      });
    },

    addAction({ id, label, shortcut, icon }: { id: string; label: string; shortcut: string; icon?: string }): void {
      emitEvent({
        type: 'plugin.action.registered',
        pluginId,
        actionId: id,
        label,
        shortcut,
        icon,
      });
    },

    removeAction(id: string): void {
      emitEvent({
        type: 'plugin.action.unregistered',
        pluginId,
        actionId: id,
      });
    },

    notify(options): void {
      emitEvent({
        type: 'plugin.notification',
        pluginId,
        title: options.title,
        body: options.body,
        level: options.level,
      });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/plugins/ui-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/ui-context.ts packages/core/src/__tests__/plugins/ui-context.test.ts
git commit -m "feat(core): implement addAction/removeAction in plugin UI context"
```

---

### Task 4: Track action events in PluginManager

**Files:**
- Modify: `packages/core/src/plugins/manager.ts`

- [ ] **Step 1: Add action event tracking to `trackingEmitEvent`**

In `packages/core/src/plugins/manager.ts`:

1. Add a type alias after line 29:
```ts
type ActionRegisteredEvent = Extract<DaemonEvent, { type: 'plugin.action.registered' }>;
```

2. Add a field after `panelEvents` (line 36):
```ts
private actionEvents = new Map<string, ActionRegisteredEvent[]>();
```

3. Update `trackingEmitEvent` (lines 77-86) to also track action events:
```ts
  private trackingEmitEvent(pluginId: string, emit: (event: DaemonEvent) => void): (event: DaemonEvent) => void {
    return (event: DaemonEvent) => {
      if (event.type === 'plugin.panel.registered') {
        this.panelEvents.set(pluginId, event as PanelRegisteredEvent);
      } else if (event.type === 'plugin.panel.unregistered') {
        this.panelEvents.delete(pluginId);
      } else if (event.type === 'plugin.action.registered') {
        const existing = this.actionEvents.get(pluginId) ?? [];
        existing.push(event as ActionRegisteredEvent);
        this.actionEvents.set(pluginId, existing);
      } else if (event.type === 'plugin.action.unregistered') {
        const existing = this.actionEvents.get(pluginId);
        if (existing) {
          const filtered = existing.filter((e) => e.actionId !== event.actionId);
          if (filtered.length > 0) {
            this.actionEvents.set(pluginId, filtered);
          } else {
            this.actionEvents.delete(pluginId);
          }
        }
      }
      emit(event);
    };
  }
```

- [ ] **Step 2: Add `getRegisteredActionEvents` method**

After `getRegisteredPanelEvents` (lines 88-91):

```ts
  getRegisteredActionEvents(): ActionRegisteredEvent[] {
    return [...this.actionEvents.values()].flat();
  }
```

- [ ] **Step 3: Include actions in the listing route**

Update the `GET /` route handler (lines 47-59) to include actions:

```ts
    this.router.get('/', (_req, res) => {
      const plugins = this.getAll().map((p) => {
        const panel = this.panelEvents.get(p.id);
        const actions = this.actionEvents.get(p.id) ?? [];
        return {
          id: p.id,
          name: p.ctx.manifest.name,
          version: p.ctx.manifest.version,
          capabilities: p.ctx.manifest.capabilities,
          panel: panel ? { zone: panel.zone, label: panel.label, icon: panel.icon } : undefined,
          actions: actions.map((a) => ({
            id: a.actionId,
            pluginId: a.pluginId,
            label: a.label,
            shortcut: a.shortcut,
            icon: a.icon,
          })),
        };
      });
      res.json({ plugins });
    });
```

- [ ] **Step 4: Clear action events in `unloadAll`**

In the `unloadAll` method (line 195), after `this.panelEvents.clear()`:
```ts
    this.actionEvents.clear();
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: Success

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/manager.ts
git commit -m "feat(core): track plugin action events in PluginManager"
```

---

### Task 5: Register quick-create action in todos plugin

**Files:**
- Modify: `packages/core/src/plugins/builtin/todos/index.ts:274-295` (activate function)

- [ ] **Step 1: Add action registration to activate function**

In `packages/core/src/plugins/builtin/todos/index.ts`, inside the `activate` function, after the `ctx.ui.addPanel(...)` call (line 292), add:

```ts
  ctx.ui.addAction({
    id: 'quick-create',
    label: 'New Task',
    shortcut: 'mod+t',
    icon: 'plus',
  });
```

And update the `onUnload` callback (line 293) to also remove the action:

```ts
  ctx.onUnload(() => {
    ctx.ui.removePanel();
    ctx.ui.removeAction('quick-create');
  });
```

- [ ] **Step 2: Run existing todos tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/plugins/builtin/todos.test.ts`
Expected: PASS (existing tests should still work — they mock emitEvent)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/builtin/todos/index.ts
git commit -m "feat(todos): register quick-create action on plugin activate"
```

---

### Task 6: Extend desktop plugin store with actions

**Files:**
- Modify: `packages/desktop/src/renderer/store/plugins.ts`

- [ ] **Step 1: Update the store**

Replace the full contents of `packages/desktop/src/renderer/store/plugins.ts`:

```ts
import { create } from 'zustand';
import type { PluginAction, PluginUIContribution } from '@qlan-ro/mainframe-types';

interface TriggeredAction {
  pluginId: string;
  actionId: string;
}

interface PluginLayoutState {
  contributions: PluginUIContribution[];
  actions: PluginAction[];
  triggeredAction: TriggeredAction | null;
  activeFullviewId: string | null;
  activeLeftPanelId: string | null;
  activeRightPanelId: string | null;

  registerContribution(c: PluginUIContribution): void;
  unregisterContribution(pluginId: string): void;
  registerAction(action: PluginAction): void;
  unregisterAction(pluginId: string, actionId: string): void;
  triggerAction(pluginId: string, actionId: string): void;
  clearTriggeredAction(): void;
  activateFullview(pluginId: string): void;
  setActiveLeftPanel(pluginId: string | null): void;
  setActiveRightPanel(pluginId: string | null): void;
}

export const usePluginLayoutStore = create<PluginLayoutState>((set) => ({
  contributions: [],
  actions: [],
  triggeredAction: null,
  activeFullviewId: null,
  activeLeftPanelId: null,
  activeRightPanelId: null,

  registerContribution: (c) =>
    set((s) => ({
      contributions: [...s.contributions.filter((e) => e.pluginId !== c.pluginId), c],
    })),
  unregisterContribution: (pluginId) =>
    set((s) => ({
      contributions: s.contributions.filter((e) => e.pluginId !== pluginId),
      activeFullviewId: s.activeFullviewId === pluginId ? null : s.activeFullviewId,
      activeLeftPanelId: s.activeLeftPanelId === pluginId ? null : s.activeLeftPanelId,
      activeRightPanelId: s.activeRightPanelId === pluginId ? null : s.activeRightPanelId,
    })),

  registerAction: (action) =>
    set((s) => ({
      actions: [...s.actions.filter((a) => !(a.pluginId === action.pluginId && a.id === action.id)), action],
    })),
  unregisterAction: (pluginId, actionId) =>
    set((s) => ({
      actions: s.actions.filter((a) => !(a.pluginId === pluginId && a.id === actionId)),
    })),
  triggerAction: (pluginId, actionId) =>
    set({ triggeredAction: { pluginId, actionId } }),
  clearTriggeredAction: () =>
    set({ triggeredAction: null }),

  activateFullview: (pluginId) =>
    set((s) => ({
      activeFullviewId: s.activeFullviewId === pluginId ? null : pluginId,
    })),
  setActiveLeftPanel: (pluginId) =>
    set({ activeLeftPanelId: pluginId, activeFullviewId: null }),
  setActiveRightPanel: (pluginId) =>
    set({ activeRightPanelId: pluginId, activeFullviewId: null }),
}));
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: May fail because other files import from this store — that's fine, we'll fix downstream in later tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/store/plugins.ts
git commit -m "feat(desktop): extend plugin layout store with actions and triggers"
```

---

### Task 7: Wire action events through desktop

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/plugins-api.ts`
- Modify: `packages/desktop/src/renderer/hooks/useAppInit.ts:53-60`
- Modify: `packages/desktop/src/renderer/lib/ws-event-router.ts`

- [ ] **Step 1: Update `PluginInfo` to include actions**

In `packages/desktop/src/renderer/lib/api/plugins-api.ts`, update the `PluginInfo` interface (lines 10-16):

```ts
interface PluginAction {
  id: string;
  pluginId: string;
  label: string;
  shortcut: string;
  icon?: string;
}

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  panel?: PluginPanel;
  actions?: PluginAction[];
}
```

- [ ] **Step 2: Load actions from plugin listing on init**

In `packages/desktop/src/renderer/hooks/useAppInit.ts`, update the plugin loading block (lines 53-62):

```ts
        try {
          const plugins = await getPlugins();
          const store = usePluginLayoutStore.getState();
          for (const plugin of plugins) {
            if (plugin.panel) {
              store.registerContribution({ pluginId: plugin.id, ...plugin.panel });
            }
            if (plugin.actions) {
              for (const action of plugin.actions) {
                store.registerAction(action);
              }
            }
          }
        } catch (err) {
          log.warn('plugin fetch failed', { err: String(err) });
        }
```

- [ ] **Step 3: Route action events in `ws-event-router.ts`**

In `packages/desktop/src/renderer/lib/ws-event-router.ts`, add an import for `usePluginLayoutStore`:

```ts
import { usePluginLayoutStore } from '../store/plugins';
```

Then add cases inside the `switch (event.type)` block (before the `'error'` case):

```ts
    case 'plugin.action.registered':
      usePluginLayoutStore.getState().registerAction({
        id: event.actionId,
        pluginId: event.pluginId,
        label: event.label,
        shortcut: event.shortcut,
        icon: event.icon,
      });
      break;
    case 'plugin.action.unregistered':
      usePluginLayoutStore.getState().unregisterAction(event.pluginId, event.actionId);
      break;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: May still fail due to missing hook/components — that's expected at this stage.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/plugins-api.ts packages/desktop/src/renderer/hooks/useAppInit.ts packages/desktop/src/renderer/lib/ws-event-router.ts
git commit -m "feat(desktop): wire plugin action events through API and WebSocket"
```

---

### Task 8: Create `usePluginShortcuts` hook

**Files:**
- Create: `packages/desktop/src/renderer/hooks/usePluginShortcuts.ts`

- [ ] **Step 1: Create the hook**

Create `packages/desktop/src/renderer/hooks/usePluginShortcuts.ts`:

```ts
import { useEffect } from 'react';
import { usePluginLayoutStore } from '../store/plugins';

/**
 * App-level shortcuts that always take precedence over plugin shortcuts.
 * Uses the 'mod+key' format where 'mod' = Cmd on Mac, Ctrl elsewhere.
 */
const APP_SHORTCUTS = new Set([
  'mod+n', // New chat
  'mod+,', // Settings
  'mod+f', // Search palette
  'mod+o', // Search palette (alias)
]);

function toModKey(e: KeyboardEvent): string | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  const mod = e.metaKey ? 'mod' : 'mod';
  const key = e.key.toLowerCase();
  if (key === 'meta' || key === 'control') return null;
  const parts: string[] = [];
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(key);
  return `${mod}+${parts.join('+')}`;
}

export function usePluginShortcuts(): void {
  const actions = usePluginLayoutStore((s) => s.actions);

  useEffect(() => {
    if (actions.length === 0) return;

    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas (unless it's a global shortcut)
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const modKey = toModKey(e);
      if (!modKey) return;

      // App shortcuts always win
      if (APP_SHORTCUTS.has(modKey)) return;

      const match = actions.find((a) => a.shortcut === modKey);
      if (match) {
        e.preventDefault();
        e.stopPropagation();
        usePluginLayoutStore.getState().triggerAction(match.pluginId, match.id);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions]);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/hooks/usePluginShortcuts.ts
git commit -m "feat(desktop): add usePluginShortcuts hook with app-shortcut priority"
```

---

### Task 9: Create `PluginGlobalComponents` and mount in App

**Files:**
- Create: `packages/desktop/src/renderer/components/plugins/PluginGlobalComponents.tsx`
- Modify: `packages/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Create `PluginGlobalComponents`**

Create `packages/desktop/src/renderer/components/plugins/PluginGlobalComponents.tsx`:

```tsx
import type React from 'react';

const BUILTIN_GLOBAL_COMPONENTS: Record<string, React.ComponentType> = {};

export function registerBuiltinGlobalComponent(pluginId: string, Component: React.ComponentType): void {
  BUILTIN_GLOBAL_COMPONENTS[pluginId] = Component;
}

export function PluginGlobalComponents(): React.ReactElement | null {
  const entries = Object.entries(BUILTIN_GLOBAL_COMPONENTS);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map(([id, Component]) => (
        <Component key={id} />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Mount in App.tsx**

In `packages/desktop/src/renderer/App.tsx`, add imports:

```ts
import { usePluginShortcuts } from './hooks/usePluginShortcuts';
import { PluginGlobalComponents } from './components/plugins/PluginGlobalComponents';
```

Inside the `App` component function body (before the `return`), add:

```ts
  usePluginShortcuts();
```

In the JSX, add `<PluginGlobalComponents />` after the `<Toaster />` line:

```tsx
<Toaster />
<PluginGlobalComponents />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success (PluginGlobalComponents is empty for now)

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/plugins/PluginGlobalComponents.tsx packages/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): add PluginGlobalComponents and mount usePluginShortcuts"
```

---

### Task 10: Create `QuickTodoDialog` component

**Files:**
- Create: `packages/desktop/src/renderer/components/todos/QuickTodoDialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `packages/desktop/src/renderer/components/todos/QuickTodoDialog.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';
import { usePluginLayoutStore } from '../../store/plugins';
import { todosApi } from '../../lib/api/todos-api';
import { getActiveProjectId } from '../../hooks/useActiveProjectId';
import { toast } from '../../lib/toast';

type QuickType = 'bug' | 'feature';
type QuickPriority = 'low' | 'medium' | 'high';

const input = cn(
  'bg-mf-app-bg border border-mf-border rounded-mf-input px-2 py-1.5',
  'text-mf-small text-mf-text-primary focus:outline-none focus:border-mf-accent',
);

const pillBase = cn(
  'px-3 py-1 text-mf-small rounded-full border transition-colors cursor-pointer',
);

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        pillBase,
        active
          ? 'bg-mf-accent text-white border-mf-accent'
          : 'bg-mf-app-bg text-mf-text-secondary border-mf-border hover:border-mf-text-secondary',
      )}
    >
      {label}
    </button>
  );
}

export function QuickTodoDialog() {
  const triggeredAction = usePluginLayoutStore((s) => s.triggeredAction);
  const clearTriggeredAction = usePluginLayoutStore((s) => s.clearTriggeredAction);

  const isOpen = triggeredAction?.pluginId === 'todos' && triggeredAction?.actionId === 'quick-create';

  const [type, setType] = useState<QuickType>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<QuickPriority>('medium');
  const [labels, setLabels] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  // We need a local open state because we clear triggeredAction on open
  const [open, setOpen] = useState(false);

  // Open when triggered, reset form
  useEffect(() => {
    if (isOpen) {
      setOpen(true);
      setType('feature');
      setTitle('');
      setBody('');
      setPriority('medium');
      setLabels('');
      setSubmitting(false);
      clearTriggeredAction();
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [isOpen, clearTriggeredAction]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || submitting) return;

    const projectId = getActiveProjectId();
    if (!projectId) {
      toast.error('No active project');
      return;
    }

    setSubmitting(true);
    try {
      const parsedLabels = labels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);

      const todo = await todosApi.create({
        projectId,
        title: title.trim(),
        body: body.trim() || undefined,
        type,
        priority,
        labels: parsedLabels.length > 0 ? parsedLabels : undefined,
      });

      toast.success(`Task #${todo.number} created`);
      setOpen(false);
    } catch (err) {
      toast.error('Failed to create task');
      setSubmitting(false);
    }
  }, [title, body, type, priority, labels, submitting]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-mf-panel-bg rounded-mf-panel border border-mf-border w-full max-w-md mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-mf-border">
          <h2 className="text-mf-small font-medium text-mf-text-primary">Quick Task</h2>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {/* Type toggle */}
          <div className="flex gap-2">
            <Pill label="Feature" active={type === 'feature'} onClick={() => setType('feature')} />
            <Pill label="Bug" active={type === 'bug'} onClick={() => setType('bug')} />
          </div>

          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className={cn(input, 'w-full')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {/* Description */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Details (optional)"
            rows={2}
            className={cn(input, 'w-full resize-none')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {/* Priority toggle */}
          <div className="flex items-center gap-2">
            <span className="text-mf-small text-mf-text-secondary">Priority</span>
            <div className="flex gap-1">
              <Pill label="Low" active={priority === 'low'} onClick={() => setPriority('low')} />
              <Pill label="Medium" active={priority === 'medium'} onClick={() => setPriority('medium')} />
              <Pill label="High" active={priority === 'high'} onClick={() => setPriority('high')} />
            </div>
          </div>

          {/* Labels */}
          <input
            type="text"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="Labels (comma-separated)"
            className={cn(input, 'w-full')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-mf-border">
          <span className="text-mf-tiny text-mf-text-tertiary">
            <kbd className="px-1 py-0.5 bg-mf-app-bg rounded border border-mf-border text-mf-tiny">Esc</kbd>
            {' '}to cancel
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className={cn(
              'px-3 py-1.5 text-mf-small rounded-mf-input transition-colors',
              'bg-mf-accent text-white hover:opacity-90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Note:** This component has a subtle pattern: it reads `triggeredAction` to know when to open, then clears it immediately (so it doesn't persist in the store) and uses a local `open` state for the dialog lifecycle.

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/todos/QuickTodoDialog.tsx
git commit -m "feat(desktop): add QuickTodoDialog component"
```

---

### Task 11: Register QuickTodoDialog as a global plugin component

**Files:**
- Modify: `packages/desktop/src/renderer/components/plugins/PluginGlobalComponents.tsx`

- [ ] **Step 1: Register the QuickTodoDialog**

In `packages/desktop/src/renderer/components/plugins/PluginGlobalComponents.tsx`, add the import and registration at the top of the file, after the `BUILTIN_GLOBAL_COMPONENTS` declaration:

```tsx
import type React from 'react';
import { QuickTodoDialog } from '../todos/QuickTodoDialog';

const BUILTIN_GLOBAL_COMPONENTS: Record<string, React.ComponentType> = {
  todos: QuickTodoDialog,
};

export function registerBuiltinGlobalComponent(pluginId: string, Component: React.ComponentType): void {
  BUILTIN_GLOBAL_COMPONENTS[pluginId] = Component;
}

export function PluginGlobalComponents(): React.ReactElement | null {
  const entries = Object.entries(BUILTIN_GLOBAL_COMPONENTS);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map(([id, Component]) => (
        <Component key={id} />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Typecheck the full desktop package**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/plugins/PluginGlobalComponents.tsx
git commit -m "feat(desktop): register QuickTodoDialog as global plugin component"
```

---

### Task 12: Build all packages and run all tests

**Files:** None (verification only)

- [ ] **Step 1: Build types package**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: Success

- [ ] **Step 2: Build core package**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: Success

- [ ] **Step 3: Build desktop package**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success

- [ ] **Step 4: Run core tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run`
Expected: All tests pass

- [ ] **Step 5: Run desktop tests (if any)**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- --run`
Expected: All tests pass (or no tests configured)

- [ ] **Step 6: Create changeset**

Run: `pnpm changeset`
Pick: `@qlan-ro/mainframe-types` (minor), `@qlan-ro/mainframe-core` (minor), `@qlan-ro/mainframe-desktop` (minor)
Summary: "Add plugin action API and quick-create todo dialog (Cmd+T)"

- [ ] **Step 7: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for quick-todos feature"
```
