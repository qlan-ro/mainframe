# Plugin UI Zones — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the ad-hoc plugin panel system with a first-class zone model (fullview, left-panel, right-panel, left-tab, right-tab) and redesign the app shell to use activity rails.

**Architecture:** Plugins declare a `zone` in their manifest; the daemon emits `plugin.panel.registered` with the zone; the desktop routes plugin components via `PluginView` and a Zustand layout store. LeftRail (redesigned ProjectRail) and a new RightRail act as activity bars. Builtins register React components in a static map; external plugins will load via ESM import (future).

**Tech Stack:** TypeScript strict, React 18, Zustand, Lucide React, Vitest, pnpm workspaces

**Branch split:**
- Tasks 1–12: `feat/plugin-system` (infrastructure)
- Tasks 13–15: `feat/todo-kanban-plugin` (todos migration, rebase onto plugin-system when done)

**Key files to read before starting:**
- `packages/types/src/plugin.ts` — existing types being replaced
- `packages/types/src/events.ts` — DaemonEvent union
- `packages/core/src/plugins/ui-context.ts` — current addPanel impl
- `packages/desktop/src/renderer/components/Layout.tsx` — shell structure
- `packages/desktop/src/renderer/components/ProjectRail.tsx` — being replaced
- `packages/desktop/src/renderer/components/TitleBar.tsx` — gains project dropdown
- `packages/desktop/src/renderer/components/panels/LeftPanel.tsx`
- `packages/desktop/src/renderer/components/panels/RightPanel.tsx`
- `packages/desktop/src/renderer/lib/client.ts` — daemonClient.onEvent pattern

---

### Task 1: UIZone type + updated types package

**Branch:** `feat/plugin-system`

**Files:**
- Modify: `packages/types/src/plugin.ts`
- Modify: `packages/types/src/events.ts`

**Step 1: Replace `PluginPanelPosition` with `UIZone` in `plugin.ts`**

Remove `PluginPanelPosition` and `PluginPanelSpec`. Replace with:

```typescript
// After the PluginCapability type, before PublicDaemonEventName

export type UIZone =
  | 'fullview'       // replaces Left + Center + Right; trigger in TitleBar
  | 'left-panel'     // replaces entire LeftPanel; trigger icon in Left Rail
  | 'right-panel'    // replaces entire RightPanel; trigger icon in Right Rail
  | 'left-tab'       // tab appended to LeftPanel tab strip
  | 'right-tab';     // tab appended to RightPanel tab strip
```

**Step 2: Add `ui` field to `PluginManifest`**

```typescript
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  capabilities: PluginCapability[];
  /** UI contribution — required when plugin adds a panel or fullview */
  ui?: {
    zone: UIZone;
    label: string;   // tooltip for rail icons; tab text for tab zones
    icon?: string;   // Lucide icon name; required for fullview/left-panel/right-panel
  };
  adapter?: {
    binaryName: string;
    displayName: string;
  };
}
```

**Step 3: Update `PluginUIContext` in `plugin.ts`**

Replace the current `addPanel(spec: PluginPanelSpec)` signature:

```typescript
export interface PluginUIContext {
  addPanel(opts: { zone: UIZone; label: string; icon?: string }): void;
  removePanel(): void;
  notify(options: { title: string; body: string; level?: 'info' | 'warning' | 'error' }): void;
}
```

**Step 4: Update `plugin.panel.registered` event in `events.ts`**

Replace the existing event member:

```typescript
| {
    type: 'plugin.panel.registered';
    pluginId: string;
    zone: UIZone;
    label: string;
    icon?: string;
  }
| { type: 'plugin.panel.unregistered'; pluginId: string }
```

(Remove `panelId`, `position`, `entryPoint` — they are no longer in the event shape.)

**Step 5: Export `UIZone` from types index**

In `packages/types/src/index.ts`, verify `UIZone` is exported (it will be if `plugin.ts` already re-exports everything). Check with:

```bash
grep "UIZone\|plugin" packages/types/src/index.ts
```

**Step 6: Verify types compile**

```bash
pnpm --filter @mainframe/types build
```

Expected: `dist/` rebuilt with no errors.

**Step 7: Commit**

```bash
git add packages/types/src/plugin.ts packages/types/src/events.ts
git commit -m "feat(types): replace PluginPanelPosition with UIZone, add manifest ui field"
```

---

### Task 2: Update core ui-context.ts

**Branch:** `feat/plugin-system`

**Files:**
- Modify: `packages/core/src/plugins/ui-context.ts`

**Step 1: Rewrite `addPanel` and `removePanel`**

Replace the entire file content:

```typescript
import type { PluginUIContext, UIZone, DaemonEvent } from '@mainframe/types';

export function createPluginUIContext(
  pluginId: string,
  emitEvent: (event: DaemonEvent) => void,
): PluginUIContext {
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

Note: the `pluginDir` parameter is removed (entryPoint is no longer sent in the event).

**Step 2: Find all callers of `createPluginUIContext` and remove the `pluginDir` argument**

```bash
grep -rn "createPluginUIContext" packages/core/src/
```

Update each call site. Typically in `packages/core/src/plugins/context.ts`:

```typescript
// Before:
createPluginUIContext(pluginId, pluginDir, emitEvent)
// After:
createPluginUIContext(pluginId, emitEvent)
```

**Step 3: Build core to verify**

```bash
pnpm --filter @mainframe/core build
```

Expected: no errors.

**Step 4: Run core tests**

```bash
pnpm --filter @mainframe/core test
```

Expected: all pass (ui-context has no tests yet; existing tests should still pass).

**Step 5: Commit**

```bash
git add packages/core/src/plugins/ui-context.ts packages/core/src/plugins/context.ts
git commit -m "feat(core): update ui-context to use UIZone, drop pluginDir and entryPoint"
```

---

### Task 3: Plugin layout Zustand store

**Branch:** `feat/plugin-system`

**Files:**
- Create: `packages/desktop/src/renderer/store/plugins.ts`
- Create: `packages/desktop/src/renderer/store/plugins.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/desktop/src/renderer/store/plugins.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginLayoutStore } from './plugins';
import type { PluginUIContribution } from '@mainframe/types';

const makeContrib = (pluginId: string, zone: PluginUIContribution['zone']): PluginUIContribution => ({
  pluginId,
  zone,
  label: pluginId,
  icon: 'star',
});

beforeEach(() => {
  usePluginLayoutStore.setState({
    contributions: [],
    activeFullviewId: null,
    activeLeftPanelId: null,
    activeRightPanelId: null,
  });
});

describe('registerContribution', () => {
  it('adds a contribution', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'fullview'));
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(1);
  });

  it('replaces an existing contribution from the same plugin', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'fullview'));
    usePluginLayoutStore.getState().registerContribution({ ...makeContrib('todos', 'fullview'), label: 'Updated' });
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(1);
    expect(usePluginLayoutStore.getState().contributions[0]?.label).toBe('Updated');
  });
});

describe('unregisterContribution', () => {
  it('removes the contribution and clears active state if that plugin was active', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'fullview'));
    usePluginLayoutStore.getState().activateFullview('todos');
    usePluginLayoutStore.getState().unregisterContribution('todos');
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(0);
    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });
});

describe('activateFullview / deactivateFullview', () => {
  it('sets activeFullviewId', () => {
    usePluginLayoutStore.getState().activateFullview('todos');
    expect(usePluginLayoutStore.getState().activeFullviewId).toBe('todos');
  });

  it('toggles off when same id activated again', () => {
    usePluginLayoutStore.getState().activateFullview('todos');
    usePluginLayoutStore.getState().activateFullview('todos');
    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });

  it('deactivates fullview when left panel is activated', () => {
    usePluginLayoutStore.getState().activateFullview('todos');
    usePluginLayoutStore.getState().setActiveLeftPanel('myPlugin');
    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
    expect(usePluginLayoutStore.getState().activeLeftPanelId).toBe('myPlugin');
  });
});

describe('setActiveLeftPanel / setActiveRightPanel', () => {
  it('sets null to restore default', () => {
    usePluginLayoutStore.getState().setActiveLeftPanel('p1');
    usePluginLayoutStore.getState().setActiveLeftPanel(null);
    expect(usePluginLayoutStore.getState().activeLeftPanelId).toBeNull();
  });

  it('left and right are independent', () => {
    usePluginLayoutStore.getState().setActiveLeftPanel('p1');
    usePluginLayoutStore.getState().setActiveRightPanel('p2');
    expect(usePluginLayoutStore.getState().activeLeftPanelId).toBe('p1');
    expect(usePluginLayoutStore.getState().activeRightPanelId).toBe('p2');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @mainframe/desktop test src/renderer/store/plugins.test.ts
```

Expected: FAIL — "Cannot find module './plugins'"

**Step 3: Implement the store**

```typescript
// packages/desktop/src/renderer/store/plugins.ts
import { create } from 'zustand';
import type { PluginUIContribution } from '@mainframe/types';

interface PluginLayoutState {
  contributions: PluginUIContribution[];
  activeFullviewId: string | null;
  activeLeftPanelId: string | null;
  activeRightPanelId: string | null;

  registerContribution(c: PluginUIContribution): void;
  unregisterContribution(pluginId: string): void;
  activateFullview(pluginId: string): void;
  setActiveLeftPanel(pluginId: string | null): void;
  setActiveRightPanel(pluginId: string | null): void;
}

export const usePluginLayoutStore = create<PluginLayoutState>((set, get) => ({
  contributions: [],
  activeFullviewId: null,
  activeLeftPanelId: null,
  activeRightPanelId: null,

  registerContribution: (c) =>
    set((state) => ({
      contributions: [
        ...state.contributions.filter((x) => x.pluginId !== c.pluginId),
        c,
      ],
    })),

  unregisterContribution: (pluginId) =>
    set((state) => ({
      contributions: state.contributions.filter((c) => c.pluginId !== pluginId),
      activeFullviewId: state.activeFullviewId === pluginId ? null : state.activeFullviewId,
      activeLeftPanelId: state.activeLeftPanelId === pluginId ? null : state.activeLeftPanelId,
      activeRightPanelId: state.activeRightPanelId === pluginId ? null : state.activeRightPanelId,
    })),

  activateFullview: (pluginId) =>
    set((state) => ({
      activeFullviewId: state.activeFullviewId === pluginId ? null : pluginId,
    })),

  setActiveLeftPanel: (pluginId) =>
    set({ activeLeftPanelId: pluginId, activeFullviewId: null }),

  setActiveRightPanel: (pluginId) =>
    set({ activeRightPanelId: pluginId }),
}));
```

**Step 4: Add `PluginUIContribution` export from types**

`PluginUIContribution` does not yet exist as a named interface — it was implicitly `PluginPanelSpec` before. Add it to `packages/types/src/plugin.ts`:

```typescript
export interface PluginUIContribution {
  pluginId: string;
  zone: UIZone;
  label: string;
  icon?: string;
}
```

Export from `packages/types/src/index.ts` if not already.

**Step 5: Run test to verify it passes**

```bash
pnpm --filter @mainframe/desktop test src/renderer/store/plugins.test.ts
```

Expected: all 8 tests pass.

**Step 6: Commit**

```bash
git add packages/types/src/plugin.ts packages/desktop/src/renderer/store/plugins.ts packages/desktop/src/renderer/store/plugins.test.ts
git commit -m "feat(desktop): add plugin layout store with UIZone-based activation"
```

---

### Task 4: PluginView component

**Branch:** `feat/plugin-system`

**Files:**
- Create: `packages/desktop/src/renderer/components/plugins/PluginView.tsx`

Note: `PluginError.tsx` already exists at this path. Verify with `ls packages/desktop/src/renderer/components/plugins/`.

**Step 1: Create `PluginView.tsx`**

```tsx
// packages/desktop/src/renderer/components/plugins/PluginView.tsx
import React from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { PluginError } from './PluginError';

// Registry of builtin plugin components.
// External plugins will be dynamically imported and registered here at load time (future).
const BUILTIN_COMPONENTS: Record<string, React.ComponentType> = {};

/** Register a builtin plugin's React component. Call before the component is first rendered. */
export function registerBuiltinComponent(pluginId: string, Component: React.ComponentType): void {
  BUILTIN_COMPONENTS[pluginId] = Component;
}

interface Props {
  pluginId: string;
}

export function PluginView({ pluginId }: Props): React.ReactElement {
  const Component = BUILTIN_COMPONENTS[pluginId];

  if (!Component) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-small">
        Plugin &quot;{pluginId}&quot; is not registered.
      </div>
    );
  }

  return (
    <ErrorBoundary fallback={<PluginError pluginId={pluginId} />}>
      <Component />
    </ErrorBoundary>
  );
}
```

**Step 2: Verify `ErrorBoundary` import path is correct**

```bash
ls packages/desktop/src/renderer/components/ErrorBoundary.tsx
```

Adjust the import if it lives elsewhere.

**Step 3: Build desktop to verify no type errors**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/plugins/PluginView.tsx
git commit -m "feat(desktop): add PluginView with BUILTIN_COMPONENTS registry"
```

---

### Task 5: LeftRail component

**Branch:** `feat/plugin-system`

**Files:**
- Create: `packages/desktop/src/renderer/components/LeftRail.tsx`

This replaces `ProjectRail.tsx`. Project management (add/remove/switch) moves to TitleBar in Task 7. For now, LeftRail renders the Sessions icon, plugin icons for left-panel contributions, and Settings/Help at bottom. Project management is temporarily removed from the rail — it will land in Task 7. Do NOT delete `ProjectRail.tsx` yet; Layout.tsx still imports it until Task 8.

**Step 1: Create the icon lookup utility inside the file**

```tsx
// packages/desktop/src/renderer/components/LeftRail.tsx
import React from 'react';
import { Settings, HelpCircle, MessageSquare, type LucideProps } from 'lucide-react';
import { cn } from '../lib/utils';
import { usePluginLayoutStore } from '../store/plugins';
import { useSettingsStore } from '../store';

// Curated map of Lucide icon names plugins may declare.
// Add entries as new plugins are introduced.
import { SquareCheck } from 'lucide-react';
const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  'square-check': SquareCheck,
  'message-square': MessageSquare,
};

function PluginIcon({ name, size = 16 }: { name: string; size?: number }): React.ReactElement | null {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon size={size} /> : null;
}

interface RailButtonProps {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}

function RailButton({ active, onClick, title, children }: RailButtonProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'w-8 h-8 flex items-center justify-center rounded-mf-card transition-colors',
        active
          ? 'bg-mf-accent text-white'
          : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg',
      )}
    >
      {children}
    </button>
  );
}

export function LeftRail(): React.ReactElement {
  const contributions = usePluginLayoutStore((s) =>
    s.contributions.filter((c) => c.zone === 'left-panel'),
  );
  const activeLeftPanelId = usePluginLayoutStore((s) => s.activeLeftPanelId);
  const { setActiveLeftPanel } = usePluginLayoutStore.getState();

  const handleSessionsClick = () => setActiveLeftPanel(null);
  const handlePluginClick = (pluginId: string) => {
    if (activeLeftPanelId === pluginId) {
      setActiveLeftPanel(null);
    } else {
      setActiveLeftPanel(pluginId);
    }
  };

  return (
    <div className="w-12 bg-mf-app-bg flex flex-col py-3 px-[6px]">
      {/* Activity icons */}
      <div className="flex-1 flex flex-col items-center gap-3 overflow-y-auto">
        {/* Default: Sessions / AI workspace */}
        <RailButton
          active={activeLeftPanelId === null}
          onClick={handleSessionsClick}
          title="Sessions"
        >
          <MessageSquare size={16} />
        </RailButton>

        {/* Left-panel plugin icons */}
        {contributions.map((c) => (
          <RailButton
            key={c.pluginId}
            active={activeLeftPanelId === c.pluginId}
            onClick={() => handlePluginClick(c.pluginId)}
            title={c.label}
          >
            {c.icon ? <PluginIcon name={c.icon} /> : <span className="text-mf-status">{c.label.charAt(0)}</span>}
          </RailButton>
        ))}
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-3 pt-3">
        <RailButton
          onClick={() => useSettingsStore.getState().open()}
          title="Settings"
        >
          <Settings size={16} />
        </RailButton>
        <RailButton
          onClick={() => useSettingsStore.getState().open(undefined, 'about')}
          title="Help"
        >
          <HelpCircle size={16} />
        </RailButton>
      </div>
    </div>
  );
}
```

**Step 2: Build to verify**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/LeftRail.tsx
git commit -m "feat(desktop): add LeftRail activity bar with Sessions default + left-panel plugin icons"
```

---

### Task 6: RightRail component

**Branch:** `feat/plugin-system`

**Files:**
- Create: `packages/desktop/src/renderer/components/RightRail.tsx`

**Step 1: Create `RightRail.tsx`**

```tsx
// packages/desktop/src/renderer/components/RightRail.tsx
import React from 'react';
import { PanelRight, type LucideProps } from 'lucide-react';
import { cn } from '../lib/utils';
import { usePluginLayoutStore } from '../store/plugins';
import { SquareCheck } from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  'square-check': SquareCheck,
  'panel-right': PanelRight,
};

function PluginIcon({ name, size = 16 }: { name: string; size?: number }): React.ReactElement | null {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon size={size} /> : null;
}

export function RightRail(): React.ReactElement {
  const contributions = usePluginLayoutStore((s) =>
    s.contributions.filter((c) => c.zone === 'right-panel'),
  );
  const activeRightPanelId = usePluginLayoutStore((s) => s.activeRightPanelId);
  const { setActiveRightPanel } = usePluginLayoutStore.getState();

  const handleContextClick = () => setActiveRightPanel(null);
  const handlePluginClick = (pluginId: string) => {
    if (activeRightPanelId === pluginId) {
      setActiveRightPanel(null);
    } else {
      setActiveRightPanel(pluginId);
    }
  };

  return (
    <div className="w-12 bg-mf-app-bg flex flex-col py-3 px-[6px]">
      <div className="flex-1 flex flex-col items-center gap-3 overflow-y-auto">
        {/* Default: Context / Files / Changes */}
        <button
          onClick={handleContextClick}
          title="Context"
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded-mf-card transition-colors',
            activeRightPanelId === null
              ? 'bg-mf-accent text-white'
              : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg',
          )}
        >
          <PanelRight size={16} />
        </button>

        {/* Right-panel plugin icons */}
        {contributions.map((c) => (
          <button
            key={c.pluginId}
            onClick={() => handlePluginClick(c.pluginId)}
            title={c.label}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-mf-card transition-colors',
              activeRightPanelId === c.pluginId
                ? 'bg-mf-accent text-white'
                : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg',
            )}
          >
            {c.icon ? <PluginIcon name={c.icon} /> : <span className="text-mf-status">{c.label.charAt(0)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Build to verify**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/RightRail.tsx
git commit -m "feat(desktop): add RightRail activity bar with Context default + right-panel plugin icons"
```

---

### Task 7: TitleBar — project dropdown + fullview icons

**Branch:** `feat/plugin-system`

**Files:**
- Modify: `packages/desktop/src/renderer/components/TitleBar.tsx`

The project name becomes a dropdown for switching/adding/removing projects. Fullview plugin icons appear on the right. This task moves all project management out of `ProjectRail`.

**Step 1: Rewrite `TitleBar.tsx`**

```tsx
// packages/desktop/src/renderer/components/TitleBar.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Plus, X, Check } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { useProjectsStore, useSearchStore, useSettingsStore } from '../store';
import { usePluginLayoutStore } from '../store/plugins';
import { createProject, removeProject } from '../lib/api';
import { cn } from '../lib/utils';
import { SquareCheck } from 'lucide-react';

// Curated icon map — shared with rails
const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  'square-check': SquareCheck,
};

function PluginIcon({ name, size = 15 }: { name: string; size?: number }): React.ReactElement | null {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon size={size} /> : null;
}

type PanelId = 'left' | 'right' | 'bottom';

interface TitleBarProps {
  panelSizes: import('react-resizable-panels').Layout;
  panelCollapsed: Record<PanelId, boolean>;
}

export function TitleBar({ panelSizes: _panelSizes, panelCollapsed: _panelCollapsed }: TitleBarProps): React.ReactElement {
  const { projects, activeProjectId, setActiveProject, addProject, removeProject: removeFromStore } = useProjectsStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const fullviewContributions = usePluginLayoutStore((s) =>
    s.contributions.filter((c) => c.zone === 'fullview'),
  );
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
  const { activateFullview } = usePluginLayoutStore.getState();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setConfirmingDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const handleAddProject = useCallback(async () => {
    setDropdownOpen(false);
    try {
      const path = await window.mainframe.openDirectoryDialog();
      if (!path) return;
      const project = await createProject(path);
      addProject(project);
      setActiveProject(project.id);
    } catch (err) {
      console.warn('[title-bar] failed to add project:', err);
    }
  }, [addProject, setActiveProject]);

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      try {
        await removeProject(id);
        removeFromStore(id);
        setConfirmingDeleteId(null);
        if (activeProjectId === id) setActiveProject(projects.find((p) => p.id !== id)?.id ?? null);
      } catch (err) {
        console.warn('[title-bar] failed to remove project:', err);
      }
    },
    [removeFromStore, activeProjectId, setActiveProject, projects],
  );

  return (
    <div className="h-11 bg-mf-app-bg flex items-center app-drag relative">

      {/* Project switcher dropdown */}
      <div className="flex items-center pl-[84px] pr-4 z-10" ref={dropdownRef}>
        <div className="relative">
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-mf-panel-bg transition-colors app-no-drag"
            title="Switch project"
          >
            {activeProject && (
              <div className="w-5 h-5 rounded flex items-center justify-center bg-mf-accent text-white text-mf-body font-semibold shrink-0">
                {activeProject.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-mf-body text-mf-text-primary font-medium">
              {activeProject?.name ?? 'No project'}
            </span>
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-mf-panel-bg border border-mf-border rounded-mf-panel shadow-xl z-50 overflow-hidden">
              {projects.map((project) => {
                const isConfirming = confirmingDeleteId === project.id;
                return (
                  <div
                    key={project.id}
                    className={cn(
                      'flex items-center px-3 py-2 text-mf-small gap-2 group',
                      activeProjectId === project.id ? 'bg-mf-hover' : 'hover:bg-mf-hover',
                    )}
                  >
                    <button
                      className="flex-1 flex items-center gap-2 text-left text-mf-text-primary"
                      onClick={() => { setActiveProject(project.id); setDropdownOpen(false); }}
                    >
                      <div className="w-5 h-5 rounded flex items-center justify-center bg-mf-accent/80 text-white text-mf-status font-semibold shrink-0">
                        {project.name.charAt(0).toUpperCase()}
                      </div>
                      {project.name}
                    </button>
                    {isConfirming ? (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleConfirmDelete(project.id)} className="text-green-400 hover:text-green-300" title="Confirm"><Check size={12} /></button>
                        <button onClick={() => setConfirmingDeleteId(null)} className="text-mf-text-secondary" title="Cancel"><X size={12} /></button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(project.id); }}
                        className="opacity-0 group-hover:opacity-100 text-mf-text-secondary hover:text-mf-destructive shrink-0"
                        title="Remove project"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                onClick={handleAddProject}
                className="flex items-center gap-2 w-full px-3 py-2 text-mf-small text-mf-text-secondary hover:bg-mf-hover border-t border-mf-border app-no-drag"
              >
                <Plus size={13} /> Add project
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Search — centered */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          onClick={() => useSearchStore.getState().open()}
          className="w-[480px] max-w-[90%] flex items-center gap-2 px-3 py-[5px] rounded-mf-card border border-mf-border text-mf-text-secondary text-mf-body app-no-drag cursor-pointer hover:border-mf-text-secondary transition-colors pointer-events-auto"
        >
          <Search size={14} />
          <span>Search ⌘F</span>
        </div>
      </div>

      {/* Fullview plugin icons — right side */}
      {fullviewContributions.length > 0 && (
        <div className="absolute right-4 flex items-center gap-1 app-no-drag">
          {fullviewContributions.map((c) => (
            <button
              key={c.pluginId}
              onClick={() => activateFullview(c.pluginId)}
              title={c.label}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded transition-colors',
                activeFullviewId === c.pluginId
                  ? 'bg-mf-accent text-white'
                  : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg',
              )}
            >
              {c.icon ? <PluginIcon name={c.icon} /> : <span className="text-mf-status">{c.label.charAt(0)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Build to verify**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/TitleBar.tsx
git commit -m "feat(desktop): TitleBar gains project picker dropdown and fullview plugin icons"
```

---

### Task 8: Layout.tsx — mount LeftRail/RightRail, handle fullview

**Branch:** `feat/plugin-system`

**Files:**
- Modify: `packages/desktop/src/renderer/components/Layout.tsx`
- Delete: `packages/desktop/src/renderer/components/ProjectRail.tsx`

**Step 1: Update `Layout.tsx`**

```tsx
// packages/desktop/src/renderer/components/Layout.tsx
import React, { useLayoutEffect, useState } from 'react';
import { Panel, Group, Separator, usePanelRef, type Layout } from 'react-resizable-panels';
import { useUIStore } from '../store';
import { useTabsStore } from '../store/tabs';
import { usePluginLayoutStore } from '../store/plugins';
import { TitleBar } from './TitleBar';
import { LeftRail } from './LeftRail';
import { RightRail } from './RightRail';
import { StatusBar } from './StatusBar';
import { PluginView } from './plugins/PluginView';

interface LayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
}

const RIGHT_PANEL_DEFAULT_PX = 300;

function ResizeHandle(): React.ReactElement {
  return <Separator className="w-mf-gap bg-mf-app-bg hover:bg-mf-divider transition-colors" />;
}

export function Layout({ leftPanel, centerPanel, rightPanel }: LayoutProps): React.ReactElement {
  const { panelCollapsed } = useUIStore();
  const [panelSizes, setPanelSizes] = useState<Layout>({});
  const rightPanelRef = usePanelRef();

  const fileView = useTabsStore((s) => s.fileView);
  const fileViewCollapsed = useTabsStore((s) => s.fileViewCollapsed);
  const sidebarWidth = useTabsStore((s) => s.sidebarWidth);
  const hasFileView = fileView != null && !fileViewCollapsed;

  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);

  useLayoutEffect(() => {
    if (!rightPanelRef.current || panelCollapsed.right || activeFullviewId) return;
    const frameId = requestAnimationFrame(() => {
      if (!rightPanelRef.current) return;
      if (hasFileView) {
        rightPanelRef.current.resize('50%');
        return;
      }
      rightPanelRef.current.resize(Math.max(sidebarWidth, RIGHT_PANEL_DEFAULT_PX));
    });
    return () => cancelAnimationFrame(frameId);
  }, [hasFileView, panelCollapsed.right, sidebarWidth, activeFullviewId]);

  return (
    <div className="h-screen flex flex-col bg-mf-app-bg">
      <TitleBar panelSizes={panelSizes} panelCollapsed={panelCollapsed} />

      <div className="flex-1 flex overflow-hidden gap-0">
        <LeftRail />

        <div className="flex-1 flex overflow-hidden p-mf-gap pt-0">
          {activeFullviewId ? (
            /* Fullview plugin — spans entire content area */
            <div className="flex-1 bg-mf-panel-bg rounded-mf-panel overflow-hidden">
              <PluginView pluginId={activeFullviewId} />
            </div>
          ) : (
            <Group orientation="horizontal" onLayoutChange={setPanelSizes}>
              {/* Left Panel */}
              {!panelCollapsed.left && (
                <>
                  <Panel id="left" defaultSize="20%" minSize="15%" maxSize="35%">
                    <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">{leftPanel}</div>
                  </Panel>
                  <ResizeHandle />
                </>
              )}

              {/* Center Panel */}
              <Panel id="center">
                <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">{centerPanel}</div>
              </Panel>

              {/* Right Panel */}
              {!panelCollapsed.right && (
                <>
                  <ResizeHandle />
                  <Panel id="right" panelRef={rightPanelRef} defaultSize="24%" minSize="10%" maxSize="70%">
                    <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">{rightPanel}</div>
                  </Panel>
                </>
              )}
            </Group>
          )}
        </div>

        <RightRail />
      </div>

      <StatusBar />
    </div>
  );
}
```

**Step 2: Delete `ProjectRail.tsx`**

```bash
git rm packages/desktop/src/renderer/components/ProjectRail.tsx
```

**Step 3: Find and remove all imports of `ProjectRail`**

```bash
grep -rn "ProjectRail" packages/desktop/src/
```

Remove any remaining import (there should only be one, which was in `Layout.tsx` — already gone).

**Step 4: Build to verify**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/Layout.tsx
git commit -m "feat(desktop): Layout mounts LeftRail/RightRail, handles fullview plugin mode"
```

---

### Task 9: LeftPanel — plugin panel switching + left-tab contributions

**Branch:** `feat/plugin-system`

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/LeftPanel.tsx`

**Step 1: Update `LeftPanel.tsx`**

```tsx
// packages/desktop/src/renderer/components/panels/LeftPanel.tsx
import React from 'react';
import { ChatsPanel } from './ChatsPanel';
import { AgentsPanel } from './AgentsPanel';
import { SkillsPanel } from './SkillsPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { usePluginLayoutStore } from '../../store/plugins';
import { PluginView } from '../plugins/PluginView';

export function LeftPanel(): React.ReactElement {
  const activeLeftPanelId = usePluginLayoutStore((s) => s.activeLeftPanelId);
  const leftTabContributions = usePluginLayoutStore((s) =>
    s.contributions.filter((c) => c.zone === 'left-tab'),
  );

  // Full-panel plugin mode
  if (activeLeftPanelId) {
    return <PluginView pluginId={activeLeftPanelId} />;
  }

  // Default tabbed content + any left-tab plugin tabs appended
  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="sessions" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="h-11 px-[10px] bg-transparent justify-start gap-1 shrink-0 rounded-none">
          <TabsTrigger value="sessions" className="text-mf-small">Sessions</TabsTrigger>
          <TabsTrigger value="skills" className="text-mf-small">Skills</TabsTrigger>
          <TabsTrigger value="agents" className="text-mf-small">Agents</TabsTrigger>
          {leftTabContributions.map((c) => (
            <TabsTrigger key={c.pluginId} value={`plugin:${c.pluginId}`} className="text-mf-small">
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="sessions" className="flex-1 overflow-hidden mt-0">
          <ChatsPanel />
        </TabsContent>
        <TabsContent value="skills" className="flex-1 overflow-hidden mt-0">
          <SkillsPanel />
        </TabsContent>
        <TabsContent value="agents" className="flex-1 overflow-hidden mt-0">
          <AgentsPanel />
        </TabsContent>
        {leftTabContributions.map((c) => (
          <TabsContent key={c.pluginId} value={`plugin:${c.pluginId}`} className="flex-1 overflow-hidden mt-0">
            <PluginView pluginId={c.pluginId} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

**Step 2: Build to verify**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/LeftPanel.tsx
git commit -m "feat(desktop): LeftPanel switches to plugin view or appends left-tab contributions"
```

---

### Task 10: RightPanel — plugin panel switching + right-tab contributions

**Branch:** `feat/plugin-system`

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/RightPanel.tsx`

**Step 1: Add plugin switching to `RightPanel.tsx`**

At the top of the component body, before the existing return, add:

```tsx
import { usePluginLayoutStore } from '../../store/plugins';
import { PluginView } from '../plugins/PluginView';

// Inside RightPanel():
const activeRightPanelId = usePluginLayoutStore((s) => s.activeRightPanelId);
const rightTabContributions = usePluginLayoutStore((s) =>
  s.contributions.filter((c) => c.zone === 'right-tab'),
);

// Full-panel plugin mode — return early before all existing logic
if (activeRightPanelId) {
  return (
    <div className="h-full">
      <PluginView pluginId={activeRightPanelId} />
    </div>
  );
}
```

For right-tab contributions, append to the existing `<TabsList>` and add matching `<TabsContent>` after `<TabsContent value="changes">`:

```tsx
{rightTabContributions.map((c) => (
  <TabsTrigger key={c.pluginId} value={`plugin:${c.pluginId}`} className="text-mf-small">
    {c.label}
  </TabsTrigger>
))}

// ... after the changes TabsContent:
{rightTabContributions.map((c) => (
  <TabsContent key={c.pluginId} value={`plugin:${c.pluginId}`} className="flex-1 overflow-hidden mt-0">
    <PluginView pluginId={c.pluginId} />
  </TabsContent>
))}
```

**Step 2: Build to verify**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/RightPanel.tsx
git commit -m "feat(desktop): RightPanel switches to plugin view or appends right-tab contributions"
```

---

### Task 11: Wire plugin.panel.registered WS events → desktop store

**Branch:** `feat/plugin-system`

**Files:**
- Modify: find where `daemonClient.onEvent` subscriptions live in the desktop

**Step 1: Find the WS event subscription point**

```bash
grep -rn "onEvent\|daemonClient" packages/desktop/src/renderer/ --include="*.ts" --include="*.tsx" | grep -v "test\|node_modules" | head -20
```

There will be a central place (likely `App.tsx` or a `useDaemon.ts` hook) where daemon events are dispatched into stores.

**Step 2: Add handler for `plugin.panel.registered`**

In the event handler switch/if block, add:

```typescript
if (event.type === 'plugin.panel.registered') {
  usePluginLayoutStore.getState().registerContribution({
    pluginId: event.pluginId,
    zone: event.zone,
    label: event.label,
    icon: event.icon,
  });
  return;
}

if (event.type === 'plugin.panel.unregistered') {
  usePluginLayoutStore.getState().unregisterContribution(event.pluginId);
  return;
}
```

Import `usePluginLayoutStore` at the top of that file.

**Step 3: Build to verify**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 4: Commit**

```bash
git add -p  # stage only the changed file
git commit -m "feat(desktop): handle plugin.panel.registered WS events in layout store"
```

---

### Task 12: Full typecheck and build verification

**Branch:** `feat/plugin-system`

**Step 1: Build all packages in order**

```bash
pnpm --filter @mainframe/types build
pnpm --filter @mainframe/core build
pnpm --filter @mainframe/desktop build
```

Expected: no errors in any package.

**Step 2: Run all tests**

```bash
pnpm --filter @mainframe/core test
pnpm --filter @mainframe/desktop test
```

Expected: all pass. The `title-generation.test.ts` tests may time out (pre-existing issue, unrelated to this work).

**Step 3: Fix any remaining type errors before moving on**

Common issues to watch for:
- `PluginUIContribution` might need to be added to `packages/types/src/index.ts` exports
- The `PluginManifest.ui` field may need to be added to Zod manifest validation in `packages/core/src/plugins/security/manifest-validator.ts` — check with `grep -r "manifest-validator\|PluginManifest" packages/core/src/plugins/`
- The `DaemonEvent` union in `events.ts` now uses `UIZone` — make sure it's imported

**Step 4: Commit any fixes**

```bash
git add -p
git commit -m "fix(types): export PluginUIContribution, wire UIZone in DaemonEvent"
```

---

## Todos Plugin Migration

> **These tasks go on `feat/todo-kanban-plugin`.**
> Before starting Task 13, rebase `feat/todo-kanban-plugin` onto the latest `feat/plugin-system`:
>
> ```bash
> git checkout feat/todo-kanban-plugin
> git rebase feat/plugin-system
> ```
>
> Resolve any conflicts (there may be none if types/events didn't conflict).

---

### Task 13: Update todos manifest + activate()

**Branch:** `feat/todo-kanban-plugin`

**Files:**
- Modify: `packages/core/src/plugins/builtin/todos/manifest.json`
- Modify: `packages/core/src/plugins/builtin/todos/index.ts`

**Step 1: Add `ui` field to `manifest.json`**

```json
{
  "id": "todos",
  "name": "TODO Kanban",
  "version": "1.0.0",
  "capabilities": ["storage", "chat:create"],
  "ui": {
    "zone": "fullview",
    "label": "Tasks",
    "icon": "square-check"
  }
}
```

**Step 2: Call `ctx.ui.addPanel()` in `activate()` in `index.ts`**

Near the end of `activate()`, after route registration, add:

```typescript
ctx.ui.addPanel({ zone: 'fullview', label: 'Tasks', icon: 'square-check' });
ctx.onUnload(() => ctx.ui.removePanel());
```

**Step 3: Build core to verify**

```bash
pnpm --filter @mainframe/core build
```

**Step 4: Commit**

```bash
git add packages/core/src/plugins/builtin/todos/manifest.json packages/core/src/plugins/builtin/todos/index.ts
git commit -m "feat(core): todos plugin declares fullview UI zone via ctx.ui.addPanel"
```

---

### Task 14: Register TodosPanel in BUILTIN_COMPONENTS + remove bespoke wiring

**Branch:** `feat/todo-kanban-plugin`

**Files:**
- Modify: `packages/desktop/src/renderer/components/plugins/PluginView.tsx`
- Modify: `packages/desktop/src/renderer/store/tabs.ts`
- Modify: `packages/desktop/src/renderer/components/center/CenterPanel.tsx`

**Step 1: Register `TodosPanel` in `PluginView.tsx`**

```typescript
// At the top of PluginView.tsx, add import:
import { TodosPanel } from '../todos/TodosPanel';

// In BUILTIN_COMPONENTS:
const BUILTIN_COMPONENTS: Record<string, React.ComponentType> = {
  todos: TodosPanel,
};
```

**Step 2: Remove `TodosTab` and `openTodosTab` from `store/tabs.ts`**

- Remove the `TodosTab` type alias (the comment says it was added for the todos plugin)
- Remove `openTodosTab` from the `TabsState` interface and implementation
- Remove `'todos'` from the `migrateSnapshot` filter (it currently allows `type === 'todos'`)
- Ensure `CenterTab = ChatTab` (remove the union if `TodosTab` was added to it)

**Step 3: Remove the todos branch from `CenterPanel.tsx`**

Find and remove:
```tsx
} : activePrimaryTab.type === 'todos' ? (
  <TodosPanel />
) : (
```

The ternary should go straight from the "no active tab" case to `<ChatContainer chatId={activePrimaryTab.chatId} />`.

**Step 4: Build to verify**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -i error | head -20
```

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/plugins/PluginView.tsx \
        packages/desktop/src/renderer/store/tabs.ts \
        packages/desktop/src/renderer/components/center/CenterPanel.tsx
git commit -m "feat(desktop): route todos through PluginView, remove bespoke TodosTab wiring"
```

---

### Task 15: Typecheck + smoke test

**Branch:** `feat/todo-kanban-plugin`

**Step 1: Full build**

```bash
pnpm --filter @mainframe/types build && pnpm --filter @mainframe/core build && pnpm --filter @mainframe/desktop build
```

Expected: no errors.

**Step 2: Run tests**

```bash
pnpm --filter @mainframe/core test
pnpm --filter @mainframe/desktop test
```

**Step 3: Manual smoke test checklist**

Start the app and verify:
- [ ] TitleBar shows project name as a dropdown button
- [ ] Clicking project name opens dropdown with project list
- [ ] Can switch projects, add project, remove project from dropdown
- [ ] Left Rail shows Sessions icon (selected by default) + Settings + Help
- [ ] Right Rail shows Context icon (selected by default)
- [ ] TitleBar right side shows a Tasks (square-check) icon once daemon starts and todos plugin loads
- [ ] Clicking Tasks icon activates fullview — TodosPanel fills the entire content area
- [ ] Left Rail and Right Rail remain visible in fullview
- [ ] Clicking Tasks icon again dismisses fullview, returns to normal layout
- [ ] Clicking Sessions icon in Left Rail while fullview is active dismisses fullview
- [ ] Creating/editing/moving/deleting todos still works

**Step 4: Commit if any fixes were needed**

```bash
git add -p
git commit -m "fix(desktop): typecheck and smoke test fixes for plugin UI zones"
```
