# IntelliJ-Style Side Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 3-column layout with an IntelliJ-style 6-zone dockable tool window system with drag-and-drop rearrangement and full persistence.

**Architecture:** New `useLayoutStore` (Zustand, persisted) owns all zone state. A `<Zone>` component renders tabbed content for any zone. Rails get 3 icon sections each. `react-resizable-panels` handles all resize. HTML5 DnD for drag-and-drop between zones.

**Tech Stack:** React, Zustand (persist), react-resizable-panels (existing), HTML5 Drag and Drop API, TypeScript.

**Spec:** `docs/superpowers/specs/2026-04-08-intellij-sidepanels-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/desktop/src/renderer/store/layout.ts` | `useLayoutStore` — zone assignments, collapsed state, actions |
| `packages/desktop/src/renderer/components/zone/Zone.tsx` | `<Zone>` — renders tab bar + active content for a zone |
| `packages/desktop/src/renderer/components/zone/ZoneTabBar.tsx` | Tab bar with drag-to-reorder within a zone |
| `packages/desktop/src/renderer/components/zone/tool-windows.ts` | Tool window registry (static builtins + dynamic plugin registration) |
| `packages/desktop/src/renderer/components/zone/BottomResizeHandle.tsx` | Custom pointer-capture resize handle for bottom area |
| `packages/desktop/src/renderer/components/zone/DragOverlay.tsx` | Ghost drop zone overlay shown during rail icon drag |
| `packages/desktop/src/__tests__/stores/layout.test.ts` | Tests for `useLayoutStore` |
| `packages/desktop/src/__tests__/components/zone.test.tsx` | Tests for `<Zone>` and `<ZoneTabBar>` |

### Modified Files

| File | Changes |
|------|---------|
| `packages/desktop/src/renderer/components/Layout.tsx` | Replace 3-panel Group with nested zone-based PanelGroups |
| `packages/desktop/src/renderer/components/LeftRail.tsx` | 3 icon sections + fixed utilities, drag support |
| `packages/desktop/src/renderer/components/RightRail.tsx` | 3 icon sections, drag support |
| `packages/desktop/src/renderer/store/ui.ts` | Remove layout-related fields (`panelCollapsed`, `panelSizes`, `panelVisible`, `leftPanelTab`, `rightPanelTab`, `bottomPanelMode`) |
| `packages/desktop/src/renderer/store/plugins.ts` | Remove `activeLeftPanelId`, `activeRightPanelId`; plugin registration routes through `useLayoutStore` |
| `packages/types/src/plugin.ts` | Update `UIZone` type to use new zone IDs; add `ToolWindowManifest` |

### Deleted Files

| File | Reason |
|------|--------|
| `packages/desktop/src/renderer/components/panels/LeftPanel.tsx` | Replaced by `<Zone id="left-top">` and `<Zone id="left-bottom">` |
| `packages/desktop/src/renderer/components/panels/RightPanel.tsx` | Replaced by `<Zone id="right-top">` and `<Zone id="right-bottom">` |
| `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx` | Replaced by `<Zone id="bottom-left">` and `<Zone id="bottom-right">` |

---

## Task 1: Tool Window Registry

**Files:**
- Create: `packages/desktop/src/renderer/components/zone/tool-windows.ts`
- Modify: `packages/types/src/plugin.ts`

- [ ] **Step 1: Write the test for the tool window registry**

Create `packages/desktop/src/__tests__/components/tool-windows.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getToolWindow,
  getAllToolWindows,
  getToolWindowsForZone,
  registerPluginToolWindow,
  unregisterPluginToolWindow,
  BUILTIN_TOOL_WINDOWS,
  type ToolWindowDef,
} from '../../renderer/components/zone/tool-windows.js';

describe('tool-windows registry', () => {
  beforeEach(() => {
    // Unregister all plugin tool windows between tests
    for (const tw of getAllToolWindows()) {
      if (!BUILTIN_TOOL_WINDOWS.some((b) => b.id === tw.id)) {
        unregisterPluginToolWindow(tw.id);
      }
    }
  });

  it('has 8 builtin tool windows', () => {
    expect(BUILTIN_TOOL_WINDOWS).toHaveLength(8);
  });

  it('getToolWindow returns a builtin by id', () => {
    const tw = getToolWindow('sessions');
    expect(tw).toBeDefined();
    expect(tw!.label).toBe('Sessions');
    expect(tw!.defaultZone).toBe('left-top');
  });

  it('getToolWindowsForZone returns correct defaults', () => {
    const leftTop = getToolWindowsForZone('left-top');
    expect(leftTop.map((t) => t.id)).toEqual(['sessions']);

    const leftBottom = getToolWindowsForZone('left-bottom');
    expect(leftBottom.map((t) => t.id)).toEqual(['skills', 'agents']);

    const rightTop = getToolWindowsForZone('right-top');
    expect(rightTop.map((t) => t.id)).toEqual(['files']);

    const rightBottom = getToolWindowsForZone('right-bottom');
    expect(rightBottom.map((t) => t.id)).toEqual(['context', 'changes']);

    const bottomLeft = getToolWindowsForZone('bottom-left');
    expect(bottomLeft.map((t) => t.id)).toEqual(['preview']);

    const bottomRight = getToolWindowsForZone('bottom-right');
    expect(bottomRight.map((t) => t.id)).toEqual(['terminal']);
  });

  it('registerPluginToolWindow adds a plugin tool window', () => {
    registerPluginToolWindow({
      id: 'plugin:my-panel',
      label: 'My Panel',
      defaultZone: 'left-top',
    });
    const tw = getToolWindow('plugin:my-panel');
    expect(tw).toBeDefined();
    expect(tw!.label).toBe('My Panel');
  });

  it('unregisterPluginToolWindow removes a plugin tool window', () => {
    registerPluginToolWindow({
      id: 'plugin:temp',
      label: 'Temp',
      defaultZone: 'right-top',
    });
    expect(getToolWindow('plugin:temp')).toBeDefined();
    unregisterPluginToolWindow('plugin:temp');
    expect(getToolWindow('plugin:temp')).toBeUndefined();
  });

  it('cannot unregister a builtin', () => {
    unregisterPluginToolWindow('sessions');
    expect(getToolWindow('sessions')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && pnpm vitest run src/__tests__/components/tool-windows.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Update ZoneId type in types package**

Modify `packages/types/src/plugin.ts`. Add the `ZoneId` type and update `UIZone`:

```typescript
export type ZoneId =
  | 'left-top'
  | 'left-bottom'
  | 'right-top'
  | 'right-bottom'
  | 'bottom-left'
  | 'bottom-right';

// Keep UIZone for backward compat with fullview
export type UIZone = ZoneId | 'fullview';

export interface ToolWindowManifest {
  id: string;
  label: string;
  icon?: string;
  defaultZone: ZoneId;
}
```

Update `PluginManifest` to add `toolWindows`:

```typescript
export interface PluginManifest {
  // ... existing fields ...
  ui?: {
    zone: UIZone;
    label: string;
    icon?: string;
    toolWindows?: ToolWindowManifest[];
  };
  // ... rest ...
}
```

- [ ] **Step 4: Build types package**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: Success

- [ ] **Step 5: Implement the tool window registry**

Create `packages/desktop/src/renderer/components/zone/tool-windows.ts`:

```typescript
import type { ComponentType } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';

export interface ToolWindowDef {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  component?: ComponentType;
  defaultZone: ZoneId;
  isBuiltin: boolean;
}

// Lazy imports to avoid circular deps — components are resolved at render time
const lazyComponent = (
  loader: () => Promise<{ default: ComponentType }>,
): ComponentType =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react').lazy(loader);

export const BUILTIN_TOOL_WINDOWS: ToolWindowDef[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    defaultZone: 'left-top',
    isBuiltin: true,
  },
  {
    id: 'skills',
    label: 'Skills',
    defaultZone: 'left-bottom',
    isBuiltin: true,
  },
  {
    id: 'agents',
    label: 'Agents',
    defaultZone: 'left-bottom',
    isBuiltin: true,
  },
  {
    id: 'files',
    label: 'Files',
    defaultZone: 'right-top',
    isBuiltin: true,
  },
  {
    id: 'context',
    label: 'Context',
    defaultZone: 'right-bottom',
    isBuiltin: true,
  },
  {
    id: 'changes',
    label: 'Changes',
    defaultZone: 'right-bottom',
    isBuiltin: true,
  },
  {
    id: 'preview',
    label: 'Preview',
    defaultZone: 'bottom-left',
    isBuiltin: true,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    defaultZone: 'bottom-right',
    isBuiltin: true,
  },
];

const pluginToolWindows = new Map<string, ToolWindowDef>();

export function getToolWindow(id: string): ToolWindowDef | undefined {
  return (
    BUILTIN_TOOL_WINDOWS.find((tw) => tw.id === id) ??
    pluginToolWindows.get(id)
  );
}

export function getAllToolWindows(): ToolWindowDef[] {
  return [...BUILTIN_TOOL_WINDOWS, ...pluginToolWindows.values()];
}

export function getToolWindowsForZone(zone: ZoneId): ToolWindowDef[] {
  return getAllToolWindows().filter((tw) => tw.defaultZone === zone);
}

export function registerPluginToolWindow(
  manifest: { id: string; label: string; icon?: ComponentType<{ className?: string }>; component?: ComponentType; defaultZone: ZoneId },
): void {
  pluginToolWindows.set(manifest.id, { ...manifest, isBuiltin: false });
}

export function unregisterPluginToolWindow(id: string): void {
  if (BUILTIN_TOOL_WINDOWS.some((tw) => tw.id === id)) return;
  pluginToolWindows.delete(id);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/desktop && pnpm vitest run src/__tests__/components/tool-windows.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/plugin.ts packages/desktop/src/renderer/components/zone/tool-windows.ts packages/desktop/src/__tests__/components/tool-windows.test.ts
git commit -m "feat(desktop): add tool window registry and ZoneId type"
```

---

## Task 2: Layout Store

**Files:**
- Create: `packages/desktop/src/renderer/store/layout.ts`
- Create: `packages/desktop/src/__tests__/stores/layout.test.ts`

- [ ] **Step 1: Write tests for the layout store**

Create `packages/desktop/src/__tests__/stores/layout.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from '../../renderer/store/layout.js';
import type { ZoneId } from '@qlan-ro/mainframe-types';

function resetStore(): void {
  localStorage.clear();
  useLayoutStore.setState({
    zones: {
      'left-top': { tabs: ['sessions'], activeTab: 'sessions' },
      'left-bottom': { tabs: ['skills', 'agents'], activeTab: 'skills' },
      'right-top': { tabs: ['files'], activeTab: 'files' },
      'right-bottom': { tabs: ['context', 'changes'], activeTab: 'context' },
      'bottom-left': { tabs: ['preview'], activeTab: 'preview' },
      'bottom-right': { tabs: ['terminal'], activeTab: 'terminal' },
    },
    collapsed: { left: false, right: false, bottom: true },
  });
}

describe('useLayoutStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('moveToolWindow', () => {
    it('moves a tool window from one zone to another', () => {
      useLayoutStore.getState().moveToolWindow('skills', 'right-top');
      const state = useLayoutStore.getState();
      expect(state.zones['left-bottom'].tabs).toEqual(['agents']);
      expect(state.zones['right-top'].tabs).toEqual(['files', 'skills']);
    });

    it('moves to a specific index', () => {
      useLayoutStore.getState().moveToolWindow('skills', 'right-top', 0);
      const state = useLayoutStore.getState();
      expect(state.zones['right-top'].tabs).toEqual(['skills', 'files']);
    });

    it('sets activeTab on target zone if it was null', () => {
      useLayoutStore.setState({
        zones: {
          ...useLayoutStore.getState().zones,
          'left-bottom': { tabs: [], activeTab: null },
        },
      });
      useLayoutStore.getState().moveToolWindow('sessions', 'left-bottom');
      const state = useLayoutStore.getState();
      expect(state.zones['left-bottom'].activeTab).toBe('sessions');
    });

    it('updates activeTab on source zone when active tab is moved', () => {
      useLayoutStore.getState().moveToolWindow('skills', 'right-top');
      const state = useLayoutStore.getState();
      expect(state.zones['left-bottom'].activeTab).toBe('agents');
    });

    it('sets source activeTab to null when last tab is moved', () => {
      useLayoutStore.getState().moveToolWindow('sessions', 'right-top');
      const state = useLayoutStore.getState();
      expect(state.zones['left-top'].tabs).toEqual([]);
      expect(state.zones['left-top'].activeTab).toBeNull();
    });
  });

  describe('reorderTab', () => {
    it('reorders tabs within a zone', () => {
      useLayoutStore.getState().reorderTab('left-bottom', 0, 1);
      const state = useLayoutStore.getState();
      expect(state.zones['left-bottom'].tabs).toEqual(['agents', 'skills']);
    });
  });

  describe('setActiveTab', () => {
    it('sets the active tab for a zone', () => {
      useLayoutStore.getState().setActiveTab('left-bottom', 'agents');
      expect(useLayoutStore.getState().zones['left-bottom'].activeTab).toBe('agents');
    });
  });

  describe('removeFromZone', () => {
    it('removes a tab from a zone', () => {
      useLayoutStore.getState().removeFromZone('left-bottom', 'skills');
      const state = useLayoutStore.getState();
      expect(state.zones['left-bottom'].tabs).toEqual(['agents']);
    });

    it('updates activeTab when the active tab is removed', () => {
      useLayoutStore.getState().removeFromZone('left-bottom', 'skills');
      const state = useLayoutStore.getState();
      expect(state.zones['left-bottom'].activeTab).toBe('agents');
    });

    it('sets activeTab to null when last tab is removed', () => {
      useLayoutStore.getState().removeFromZone('left-top', 'sessions');
      const state = useLayoutStore.getState();
      expect(state.zones['left-top'].activeTab).toBeNull();
    });
  });

  describe('toggleSide', () => {
    it('toggles collapsed state', () => {
      expect(useLayoutStore.getState().collapsed.left).toBe(false);
      useLayoutStore.getState().toggleSide('left');
      expect(useLayoutStore.getState().collapsed.left).toBe(true);
      useLayoutStore.getState().toggleSide('left');
      expect(useLayoutStore.getState().collapsed.left).toBe(false);
    });
  });

  describe('resetLayout', () => {
    it('restores default zone assignments', () => {
      useLayoutStore.getState().moveToolWindow('sessions', 'bottom-right');
      useLayoutStore.getState().resetLayout();
      const state = useLayoutStore.getState();
      expect(state.zones['left-top'].tabs).toEqual(['sessions']);
      expect(state.zones['bottom-right'].tabs).toEqual(['terminal']);
    });
  });

  describe('findZoneForToolWindow', () => {
    it('finds the zone containing a tool window', () => {
      const zone = useLayoutStore.getState().findZoneForToolWindow('terminal');
      expect(zone).toBe('bottom-right');
    });

    it('returns null for unregistered tool window', () => {
      const zone = useLayoutStore.getState().findZoneForToolWindow('nonexistent');
      expect(zone).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && pnpm vitest run src/__tests__/stores/layout.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the layout store**

Create `packages/desktop/src/renderer/store/layout.ts`:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ZoneId } from '@qlan-ro/mainframe-types';

export interface ZoneState {
  tabs: string[];
  activeTab: string | null;
}

type CollapsibleSide = 'left' | 'right' | 'bottom';

interface LayoutState {
  zones: Record<ZoneId, ZoneState>;
  collapsed: Record<CollapsibleSide, boolean>;
}

const DEFAULT_ZONES: Record<ZoneId, ZoneState> = {
  'left-top': { tabs: ['sessions'], activeTab: 'sessions' },
  'left-bottom': { tabs: ['skills', 'agents'], activeTab: 'skills' },
  'right-top': { tabs: ['files'], activeTab: 'files' },
  'right-bottom': { tabs: ['context', 'changes'], activeTab: 'context' },
  'bottom-left': { tabs: ['preview'], activeTab: 'preview' },
  'bottom-right': { tabs: ['terminal'], activeTab: 'terminal' },
};

const DEFAULT_COLLAPSED: Record<CollapsibleSide, boolean> = {
  left: false,
  right: false,
  bottom: true,
};

function buildDefaultZones(): Record<ZoneId, ZoneState> {
  return JSON.parse(JSON.stringify(DEFAULT_ZONES)) as Record<ZoneId, ZoneState>;
}

interface LayoutActions {
  moveToolWindow(toolWindowId: string, targetZone: ZoneId, index?: number): void;
  reorderTab(zoneId: ZoneId, fromIndex: number, toIndex: number): void;
  setActiveTab(zoneId: ZoneId, tabId: string): void;
  removeFromZone(zoneId: ZoneId, toolWindowId: string): void;
  toggleSide(side: CollapsibleSide): void;
  resetLayout(): void;
  findZoneForToolWindow(toolWindowId: string): ZoneId | null;
}

export const useLayoutStore = create<LayoutState & LayoutActions>()(
  persist(
    (set, get) => ({
      zones: buildDefaultZones(),
      collapsed: { ...DEFAULT_COLLAPSED },

      moveToolWindow(toolWindowId, targetZone, index) {
        set((state) => {
          const zones = JSON.parse(JSON.stringify(state.zones)) as Record<ZoneId, ZoneState>;

          // Remove from source zone
          let sourceZone: ZoneId | null = null;
          for (const [zid, zone] of Object.entries(zones) as [ZoneId, ZoneState][]) {
            const idx = zone.tabs.indexOf(toolWindowId);
            if (idx !== -1) {
              sourceZone = zid;
              zone.tabs.splice(idx, 1);
              if (zone.activeTab === toolWindowId) {
                zone.activeTab = zone.tabs[0] ?? null;
              }
              break;
            }
          }

          // Add to target zone
          const target = zones[targetZone];
          if (index !== undefined && index >= 0 && index <= target.tabs.length) {
            target.tabs.splice(index, 0, toolWindowId);
          } else {
            target.tabs.push(toolWindowId);
          }
          if (target.activeTab === null) {
            target.activeTab = toolWindowId;
          }

          return { zones };
        });
      },

      reorderTab(zoneId, fromIndex, toIndex) {
        set((state) => {
          const zones = JSON.parse(JSON.stringify(state.zones)) as Record<ZoneId, ZoneState>;
          const zone = zones[zoneId];
          if (!zone || fromIndex < 0 || fromIndex >= zone.tabs.length) return state;
          const [tab] = zone.tabs.splice(fromIndex, 1);
          if (!tab) return state;
          const clampedTo = Math.min(toIndex, zone.tabs.length);
          zone.tabs.splice(clampedTo, 0, tab);
          return { zones };
        });
      },

      setActiveTab(zoneId, tabId) {
        set((state) => {
          const zones = JSON.parse(JSON.stringify(state.zones)) as Record<ZoneId, ZoneState>;
          const zone = zones[zoneId];
          if (!zone || !zone.tabs.includes(tabId)) return state;
          zone.activeTab = tabId;
          return { zones };
        });
      },

      removeFromZone(zoneId, toolWindowId) {
        set((state) => {
          const zones = JSON.parse(JSON.stringify(state.zones)) as Record<ZoneId, ZoneState>;
          const zone = zones[zoneId];
          if (!zone) return state;
          const idx = zone.tabs.indexOf(toolWindowId);
          if (idx === -1) return state;
          zone.tabs.splice(idx, 1);
          if (zone.activeTab === toolWindowId) {
            zone.activeTab = zone.tabs[0] ?? null;
          }
          return { zones };
        });
      },

      toggleSide(side) {
        set((state) => ({
          collapsed: { ...state.collapsed, [side]: !state.collapsed[side] },
        }));
      },

      resetLayout() {
        set({
          zones: buildDefaultZones(),
          collapsed: { ...DEFAULT_COLLAPSED },
        });
      },

      findZoneForToolWindow(toolWindowId) {
        const { zones } = get();
        for (const [zid, zone] of Object.entries(zones) as [ZoneId, ZoneState][]) {
          if (zone.tabs.includes(toolWindowId)) return zid;
        }
        return null;
      },
    }),
    {
      name: 'mainframe-layout',
    },
  ),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && pnpm vitest run src/__tests__/stores/layout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/store/layout.ts packages/desktop/src/__tests__/stores/layout.test.ts
git commit -m "feat(desktop): add useLayoutStore for zone-based layout state"
```

---

## Task 3: Zone Component

**Files:**
- Create: `packages/desktop/src/renderer/components/zone/ZoneTabBar.tsx`
- Create: `packages/desktop/src/renderer/components/zone/Zone.tsx`

- [ ] **Step 1: Write the test for ZoneTabBar drag reorder**

Create `packages/desktop/src/__tests__/components/zone.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoneTabBar } from '../../renderer/components/zone/ZoneTabBar.js';
import { useLayoutStore } from '../../renderer/store/layout.js';

function resetStore(): void {
  localStorage.clear();
  useLayoutStore.setState({
    zones: {
      'left-top': { tabs: ['sessions'], activeTab: 'sessions' },
      'left-bottom': { tabs: ['skills', 'agents'], activeTab: 'skills' },
      'right-top': { tabs: ['files'], activeTab: 'files' },
      'right-bottom': { tabs: ['context', 'changes'], activeTab: 'context' },
      'bottom-left': { tabs: ['preview'], activeTab: 'preview' },
      'bottom-right': { tabs: ['terminal'], activeTab: 'terminal' },
    },
    collapsed: { left: false, right: false, bottom: true },
  });
}

describe('ZoneTabBar', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders tabs for the zone', () => {
    render(<ZoneTabBar zoneId="left-bottom" />);
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });

  it('highlights the active tab', () => {
    render(<ZoneTabBar zoneId="left-bottom" />);
    const skillsTab = screen.getByText('Skills').closest('[data-active]');
    expect(skillsTab?.getAttribute('data-active')).toBe('true');
  });

  it('clicking a tab sets it as active', () => {
    render(<ZoneTabBar zoneId="left-bottom" />);
    fireEvent.click(screen.getByText('Agents'));
    expect(useLayoutStore.getState().zones['left-bottom'].activeTab).toBe('agents');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && pnpm vitest run src/__tests__/components/zone.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ZoneTabBar**

Create `packages/desktop/src/renderer/components/zone/ZoneTabBar.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../../store/layout.js';
import { getToolWindow } from './tool-windows.js';

interface ZoneTabBarProps {
  zoneId: ZoneId;
}

export function ZoneTabBar({ zoneId }: ZoneTabBarProps): React.ReactElement | null {
  const zone = useLayoutStore((s) => s.zones[zoneId]);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const reorderTab = useLayoutStore((s) => s.reorderTab);
  const removeFromZone = useLayoutStore((s) => s.removeFromZone);

  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragSourceIndex = useRef<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      dragSourceIndex.current = index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `tab:${zoneId}:${index}`);
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = '0.4';
      }
    },
    [zoneId],
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    dragSourceIndex.current = null;
    setDragOverIndex(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverIndex(index);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      setDragOverIndex(null);
      const fromIndex = dragSourceIndex.current;
      if (fromIndex !== null && fromIndex !== toIndex) {
        reorderTab(zoneId, fromIndex, toIndex);
      }
      dragSourceIndex.current = null;
    },
    [zoneId, reorderTab],
  );

  if (!zone || zone.tabs.length === 0) return null;

  return (
    <div className="flex h-7 items-center bg-mf-surface-secondary border-b border-mf-border overflow-x-auto">
      {zone.tabs.map((tabId, index) => {
        const tw = getToolWindow(tabId);
        if (!tw) return null;
        const isActive = zone.activeTab === tabId;
        return (
          <button
            key={tabId}
            data-active={isActive}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onClick={() => setActiveTab(zoneId, tabId)}
            className={`
              flex items-center gap-1 px-3 h-full text-xs shrink-0
              border-b-2 transition-colors
              ${isActive
                ? 'border-mf-accent text-mf-text-primary'
                : 'border-transparent text-mf-text-secondary hover:text-mf-text-primary'}
              ${dragOverIndex === index ? 'border-l-2 border-l-mf-accent' : ''}
            `}
          >
            <span>{tw.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Implement Zone component**

Create `packages/desktop/src/renderer/components/zone/Zone.tsx`:

```tsx
import { Suspense, useMemo } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../../store/layout.js';
import { getToolWindow } from './tool-windows.js';
import { ZoneTabBar } from './ZoneTabBar.js';

interface ZoneProps {
  id: ZoneId;
}

export function Zone({ id }: ZoneProps): React.ReactElement | null {
  const zone = useLayoutStore((s) => s.zones[id]);

  const ActiveComponent = useMemo(() => {
    if (!zone?.activeTab) return null;
    const tw = getToolWindow(zone.activeTab);
    return tw?.component ?? null;
  }, [zone?.activeTab]);

  if (!zone || zone.tabs.length === 0) return null;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <ZoneTabBar zoneId={id} />
      <div className="flex-1 overflow-auto">
        {ActiveComponent ? (
          <Suspense fallback={<div className="flex-1" />}>
            <ActiveComponent />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/desktop && pnpm vitest run src/__tests__/components/zone.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/zone/Zone.tsx packages/desktop/src/renderer/components/zone/ZoneTabBar.tsx packages/desktop/src/__tests__/components/zone.test.tsx
git commit -m "feat(desktop): add Zone and ZoneTabBar components"
```

---

## Task 4: Bottom Resize Handle

**Files:**
- Create: `packages/desktop/src/renderer/components/zone/BottomResizeHandle.tsx`

- [ ] **Step 1: Implement BottomResizeHandle**

Create `packages/desktop/src/renderer/components/zone/BottomResizeHandle.tsx`:

```tsx
import { useCallback, useRef } from 'react';

interface BottomResizeHandleProps {
  onResize: (deltaY: number) => void;
}

export function BottomResizeHandle({ onResize }: BottomResizeHandleProps): React.ReactElement {
  const startY = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startY.current = e.clientY;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const handleMove = (me: PointerEvent): void => {
        const delta = startY.current - me.clientY;
        startY.current = me.clientY;
        onResize(delta);
      };

      const handleUp = (): void => {
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', handleUp);
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', handleUp);
    },
    [onResize],
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      className="h-[3px] cursor-row-resize bg-mf-border hover:bg-mf-accent transition-colors shrink-0"
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/zone/BottomResizeHandle.tsx
git commit -m "feat(desktop): add BottomResizeHandle component"
```

---

## Task 5: Rewrite Layout.tsx

**Files:**
- Modify: `packages/desktop/src/renderer/components/Layout.tsx`

- [ ] **Step 1: Read the current Layout.tsx**

Read: `packages/desktop/src/renderer/components/Layout.tsx`
Understand the current structure and all imports.

- [ ] **Step 2: Rewrite Layout.tsx with zone-based structure**

Replace `packages/desktop/src/renderer/components/Layout.tsx` with the new nested PanelGroup structure:

```tsx
import { useCallback, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useLayoutStore } from '../store/layout.js';
import { usePluginLayoutStore } from '../store/plugins.js';
import { TitleBar } from './TitleBar.js';
import { LeftRail } from './LeftRail.js';
import { RightRail } from './RightRail.js';
import { StatusBar } from './StatusBar.js';
import { Zone } from './zone/Zone.js';
import { BottomResizeHandle } from './zone/BottomResizeHandle.js';
import { PluginView } from '../plugins/PluginView.js';

const MIN_BOTTOM_HEIGHT = 120;

interface LayoutProps {
  centerPanel: React.ReactNode;
}

export function Layout({ centerPanel }: LayoutProps): React.ReactElement {
  const collapsed = useLayoutStore((s) => s.collapsed);
  const zones = useLayoutStore((s) => s.zones);
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);

  const [bottomHeight, setBottomHeight] = useState(200);

  const handleBottomResize = useCallback((delta: number) => {
    setBottomHeight((h) => Math.max(MIN_BOTTOM_HEIGHT, h + delta));
  }, []);

  const hasLeftTop = zones['left-top'].tabs.length > 0;
  const hasLeftBottom = zones['left-bottom'].tabs.length > 0;
  const hasLeft = (hasLeftTop || hasLeftBottom) && !collapsed.left;

  const hasRightTop = zones['right-top'].tabs.length > 0;
  const hasRightBottom = zones['right-bottom'].tabs.length > 0;
  const hasRight = (hasRightTop || hasRightBottom) && !collapsed.right;

  const hasBottomLeft = zones['bottom-left'].tabs.length > 0;
  const hasBottomRight = zones['bottom-right'].tabs.length > 0;
  const hasBottom = (hasBottomLeft || hasBottomRight) && !collapsed.bottom;

  return (
    <div className="h-screen flex flex-col">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        <LeftRail />
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeFullviewId ? (
            <div className="flex-1 overflow-hidden">
              <PluginView pluginId={activeFullviewId} />
            </div>
          ) : (
            <>
              {/* Upper area: left column + center + right column */}
              <PanelGroup direction="horizontal" autoSaveId="mainframe-horizontal">
                {hasLeft && (
                  <>
                    <Panel
                      id="left-column"
                      defaultSize={22}
                      minSize={10}
                      maxSize={40}
                      order={1}
                    >
                      <PanelGroup direction="vertical" autoSaveId="mainframe-left-vertical">
                        {hasLeftTop && (
                          <Panel id="left-top" defaultSize={60} minSize={20} order={1}>
                            <Zone id="left-top" />
                          </Panel>
                        )}
                        {hasLeftTop && hasLeftBottom && (
                          <PanelResizeHandle className="h-[3px] bg-mf-border hover:bg-mf-accent transition-colors" />
                        )}
                        {hasLeftBottom && (
                          <Panel id="left-bottom" defaultSize={40} minSize={20} order={2}>
                            <Zone id="left-bottom" />
                          </Panel>
                        )}
                      </PanelGroup>
                    </Panel>
                    <PanelResizeHandle className="w-[3px] bg-mf-border hover:bg-mf-accent transition-colors" />
                  </>
                )}

                <Panel id="center" order={2}>
                  {centerPanel}
                </Panel>

                {hasRight && (
                  <>
                    <PanelResizeHandle className="w-[3px] bg-mf-border hover:bg-mf-accent transition-colors" />
                    <Panel
                      id="right-column"
                      defaultSize={22}
                      minSize={10}
                      maxSize={40}
                      order={3}
                    >
                      <PanelGroup direction="vertical" autoSaveId="mainframe-right-vertical">
                        {hasRightTop && (
                          <Panel id="right-top" defaultSize={60} minSize={20} order={1}>
                            <Zone id="right-top" />
                          </Panel>
                        )}
                        {hasRightTop && hasRightBottom && (
                          <PanelResizeHandle className="h-[3px] bg-mf-border hover:bg-mf-accent transition-colors" />
                        )}
                        {hasRightBottom && (
                          <Panel id="right-bottom" defaultSize={40} minSize={20} order={2}>
                            <Zone id="right-bottom" />
                          </Panel>
                        )}
                      </PanelGroup>
                    </Panel>
                  </>
                )}
              </PanelGroup>

              {/* Bottom area: full width */}
              {hasBottom && (
                <>
                  <BottomResizeHandle onResize={handleBottomResize} />
                  <div style={{ height: bottomHeight, flexShrink: 0 }}>
                    <PanelGroup direction="horizontal" autoSaveId="mainframe-bottom-horizontal">
                      {hasBottomLeft && (
                        <Panel id="bottom-left" defaultSize={50} minSize={20} order={1}>
                          <Zone id="bottom-left" />
                        </Panel>
                      )}
                      {hasBottomLeft && hasBottomRight && (
                        <PanelResizeHandle className="w-[3px] bg-mf-border hover:bg-mf-accent transition-colors" />
                      )}
                      {hasBottomRight && (
                        <Panel id="bottom-right" defaultSize={50} minSize={20} order={2}>
                          <Zone id="bottom-right" />
                        </Panel>
                      )}
                    </PanelGroup>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <RightRail />
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 3: Update App.tsx to pass only centerPanel**

Read `packages/desktop/src/renderer/App.tsx` and update the `<Layout>` usage. Remove `leftPanel` and `rightPanel` props — the zones handle those now. Only pass `centerPanel`:

```tsx
<Layout centerPanel={<CenterPanel />} />
```

Remove the `<LeftPanel />` and `<RightPanel />` imports.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success (or identify remaining type errors to fix)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/Layout.tsx packages/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): rewrite Layout with zone-based PanelGroups"
```

---

## Task 6: Wire Tool Window Components into Registry

**Files:**
- Modify: `packages/desktop/src/renderer/components/zone/tool-windows.ts`

- [ ] **Step 1: Add component and icon references to builtin tool windows**

Update `tool-windows.ts` to import the actual panel components and Lucide icons. Use `React.lazy` for heavy components (TerminalPanel):

```typescript
import React from 'react';
import {
  MessageSquare,
  Wand2,
  Bot,
  FolderOpen,
  BookOpen,
  GitBranch,
  Eye,
  Terminal,
} from 'lucide-react';
import { ChatsPanel } from '../panels/ChatsPanel.js';
import { SkillsPanel } from '../panels/SkillsPanel.js';
import { AgentsPanel } from '../panels/AgentsPanel.js';
import { FilesTab } from '../panels/FilesTab.js';
import { ContextTab } from '../panels/ContextTab.js';
import { ChangesTab } from '../panels/ChangesTab.js';
import { PreviewTab } from '../sandbox/PreviewTab.js';

const LazyTerminalPanel = React.lazy(
  () => import('../terminal/TerminalPanel.js'),
);
```

Update each entry in `BUILTIN_TOOL_WINDOWS` to include `icon` and `component`:

```typescript
{
  id: 'sessions',
  label: 'Sessions',
  icon: MessageSquare,
  component: ChatsPanel,
  defaultZone: 'left-top',
  isBuiltin: true,
},
// ... same pattern for all 8
```

- [ ] **Step 2: Verify the icons and component imports resolve**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/zone/tool-windows.ts
git commit -m "feat(desktop): wire component and icon refs into tool window registry"
```

---

## Task 7: Rewrite LeftRail with 3 Sections

**Files:**
- Modify: `packages/desktop/src/renderer/components/LeftRail.tsx`

- [ ] **Step 1: Read the current LeftRail.tsx**

Read: `packages/desktop/src/renderer/components/LeftRail.tsx`
Note all current buttons, their order, and click handlers.

- [ ] **Step 2: Rewrite LeftRail with 3 icon sections + fixed utilities**

Replace `LeftRail.tsx` content. The rail now reads from `useLayoutStore` to know which tool windows are in each zone. Structure:

```tsx
import { useCallback } from 'react';
import { Settings, HelpCircle, ListChecks } from 'lucide-react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../store/layout.js';
import { useSettingsStore } from '../store/settings.js';
import { getToolWindow } from './zone/tool-windows.js';

function RailButton({
  active,
  onClick,
  title,
  draggable,
  onDragStart,
  onDragEnd,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`
        w-9 h-9 flex items-center justify-center rounded-md transition-colors
        ${active ? 'bg-mf-accent/20 text-mf-accent' : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-surface-hover'}
      `}
    >
      {children}
    </button>
  );
}

function RailSection({
  zoneId,
  onDragOver,
  onDrop,
  className,
}: {
  zoneId: ZoneId;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  className?: string;
}): React.ReactElement {
  const zone = useLayoutStore((s) => s.zones[zoneId]);
  const collapsed = useLayoutStore((s) => s.collapsed);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const toggleSide = useLayoutStore((s) => s.toggleSide);

  const side = zoneId.startsWith('left') ? 'left' : zoneId.startsWith('right') ? 'right' : 'bottom';
  const isCollapsed = collapsed[side];

  const handleClick = useCallback(
    (tabId: string) => {
      if (isCollapsed) {
        toggleSide(side);
        setActiveTab(zoneId, tabId);
      } else if (zone.activeTab === tabId) {
        toggleSide(side);
      } else {
        setActiveTab(zoneId, tabId);
      }
    },
    [isCollapsed, zone.activeTab, zoneId, side, toggleSide, setActiveTab],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, tabId: string) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-toolwindow', tabId);
    },
    [],
  );

  return (
    <div
      className={`flex flex-col items-center gap-1 ${className ?? ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-zone={zoneId}
    >
      {zone.tabs.map((tabId) => {
        const tw = getToolWindow(tabId);
        if (!tw) return null;
        const Icon = tw.icon;
        const isActive = !isCollapsed && zone.activeTab === tabId;
        return (
          <RailButton
            key={tabId}
            active={isActive}
            onClick={() => handleClick(tabId)}
            title={tw.label}
            draggable
            onDragStart={(e) => handleDragStart(e, tabId)}
          >
            {Icon ? <Icon className="w-5 h-5" /> : <span className="text-xs">{tw.label[0]}</span>}
          </RailButton>
        );
      })}
    </div>
  );
}

export function LeftRail(): React.ReactElement {
  const { openSettings } = useSettingsStore();
  const moveToolWindow = useLayoutStore((s) => s.moveToolWindow);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-toolwindow')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const makeDropHandler = useCallback(
    (targetZone: ZoneId) => (e: React.DragEvent) => {
      e.preventDefault();
      const toolWindowId = e.dataTransfer.getData('application/x-toolwindow');
      if (toolWindowId) {
        moveToolWindow(toolWindowId, targetZone);
      }
    },
    [moveToolWindow],
  );

  return (
    <div className="w-11 bg-mf-surface-secondary flex flex-col items-center py-2 border-r border-mf-border shrink-0">
      {/* Section 1: left-top */}
      <RailSection
        zoneId="left-top"
        onDragOver={handleDragOver}
        onDrop={makeDropHandler('left-top')}
      />

      {/* Divider */}
      <div className="w-6 h-px bg-mf-border my-2" />

      {/* Section 2: left-bottom */}
      <RailSection
        zoneId="left-bottom"
        onDragOver={handleDragOver}
        onDrop={makeDropHandler('left-bottom')}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Section 3: bottom-left */}
      <RailSection
        zoneId="bottom-left"
        onDragOver={handleDragOver}
        onDrop={makeDropHandler('bottom-left')}
      />

      {/* Fixed utilities separator */}
      <div className="w-6 h-px bg-mf-border my-2" />

      {/* Fixed utility buttons */}
      <RailButton active={false} onClick={() => {}} title="Todos">
        <ListChecks className="w-5 h-5" />
      </RailButton>
      <RailButton active={false} onClick={openSettings} title="Settings">
        <Settings className="w-5 h-5" />
      </RailButton>
      <RailButton active={false} onClick={() => {}} title="Help">
        <HelpCircle className="w-5 h-5" />
      </RailButton>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/LeftRail.tsx
git commit -m "feat(desktop): rewrite LeftRail with 3 zone sections + fixed utilities"
```

---

## Task 8: Rewrite RightRail with 3 Sections

**Files:**
- Modify: `packages/desktop/src/renderer/components/RightRail.tsx`

- [ ] **Step 1: Read the current RightRail.tsx**

Read: `packages/desktop/src/renderer/components/RightRail.tsx`

- [ ] **Step 2: Rewrite RightRail with 3 icon sections**

Same pattern as LeftRail but for right-side zones. Import `RailButton` and `RailSection` — but since they're defined inline in LeftRail, extract them first to a shared file.

Create `packages/desktop/src/renderer/components/zone/RailSection.tsx` and move `RailButton` and `RailSection` there. Then import in both LeftRail and RightRail.

RightRail structure:

```tsx
import { useCallback } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../store/layout.js';
import { RailSection, RailButton } from './zone/RailSection.js';

export function RightRail(): React.ReactElement {
  const moveToolWindow = useLayoutStore((s) => s.moveToolWindow);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-toolwindow')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const makeDropHandler = useCallback(
    (targetZone: ZoneId) => (e: React.DragEvent) => {
      e.preventDefault();
      const toolWindowId = e.dataTransfer.getData('application/x-toolwindow');
      if (toolWindowId) {
        moveToolWindow(toolWindowId, targetZone);
      }
    },
    [moveToolWindow],
  );

  return (
    <div className="w-11 bg-mf-surface-secondary flex flex-col items-center py-2 border-l border-mf-border shrink-0">
      {/* Section 1: right-top */}
      <RailSection
        zoneId="right-top"
        onDragOver={handleDragOver}
        onDrop={makeDropHandler('right-top')}
      />

      {/* Divider */}
      <div className="w-6 h-px bg-mf-border my-2" />

      {/* Section 2: right-bottom */}
      <RailSection
        zoneId="right-bottom"
        onDragOver={handleDragOver}
        onDrop={makeDropHandler('right-bottom')}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Section 3: bottom-right */}
      <RailSection
        zoneId="bottom-right"
        onDragOver={handleDragOver}
        onDrop={makeDropHandler('bottom-right')}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/zone/RailSection.tsx packages/desktop/src/renderer/components/LeftRail.tsx packages/desktop/src/renderer/components/RightRail.tsx
git commit -m "feat(desktop): rewrite RightRail, extract shared RailSection"
```

---

## Task 9: Drag Overlay for Ghost Drop Zones

**Files:**
- Create: `packages/desktop/src/renderer/components/zone/DragOverlay.tsx`
- Modify: `packages/desktop/src/renderer/components/zone/RailSection.tsx`

- [ ] **Step 1: Add drag state tracking**

Add a simple context or module-level state to track when a rail icon drag is in progress. This enables all rail sections to show drop zone highlights.

Create `packages/desktop/src/renderer/components/zone/DragOverlay.tsx`:

```tsx
import { createContext, useCallback, useContext, useState } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';

interface DragState {
  isDragging: boolean;
  sourceToolWindow: string | null;
  hoveredZone: ZoneId | null;
}

interface DragContextValue extends DragState {
  startDrag: (toolWindowId: string) => void;
  endDrag: () => void;
  setHoveredZone: (zone: ZoneId | null) => void;
}

const DragContext = createContext<DragContextValue>({
  isDragging: false,
  sourceToolWindow: null,
  hoveredZone: null,
  startDrag: () => {},
  endDrag: () => {},
  setHoveredZone: () => {},
});

export function useDragContext(): DragContextValue {
  return useContext(DragContext);
}

export function DragProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<DragState>({
    isDragging: false,
    sourceToolWindow: null,
    hoveredZone: null,
  });

  const startDrag = useCallback((toolWindowId: string) => {
    setState({ isDragging: true, sourceToolWindow: toolWindowId, hoveredZone: null });
  }, []);

  const endDrag = useCallback(() => {
    setState({ isDragging: false, sourceToolWindow: null, hoveredZone: null });
  }, []);

  const setHoveredZone = useCallback((zone: ZoneId | null) => {
    setState((s) => ({ ...s, hoveredZone: zone }));
  }, []);

  return (
    <DragContext.Provider value={{ ...state, startDrag, endDrag, setHoveredZone }}>
      {children}
    </DragContext.Provider>
  );
}
```

- [ ] **Step 2: Update RailSection to use drag context**

Modify `RailSection.tsx` to:
- Call `startDrag(tabId)` on `dragstart`, `endDrag()` on `dragend`
- Call `setHoveredZone(zoneId)` on `dragenter`, `setHoveredZone(null)` on `dragleave`
- Show a highlight overlay when `isDragging && hoveredZone === zoneId`

Add to the RailSection wrapper div:

```tsx
const { isDragging, hoveredZone, setHoveredZone, startDrag, endDrag } = useDragContext();
const isDropTarget = isDragging && hoveredZone === zoneId;

// On the container div:
<div
  className={`
    flex flex-col items-center gap-1 rounded-md transition-colors
    ${isDropTarget ? 'bg-mf-accent/20 ring-2 ring-mf-accent/40' : ''}
    ${className ?? ''}
  `}
  onDragOver={onDragOver}
  onDragEnter={() => setHoveredZone(zoneId)}
  onDragLeave={() => setHoveredZone(null)}
  onDrop={onDrop}
  data-zone={zoneId}
>
```

Update `handleDragStart` to also call `startDrag(tabId)` and add `onDragEnd` to call `endDrag()`.

- [ ] **Step 3: Wrap Layout with DragProvider**

In `Layout.tsx`, wrap the content with `<DragProvider>`:

```tsx
import { DragProvider } from './zone/DragOverlay.js';

// In the return:
return (
  <DragProvider>
    <div className="h-screen flex flex-col">
      {/* ... existing layout ... */}
    </div>
  </DragProvider>
);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/zone/DragOverlay.tsx packages/desktop/src/renderer/components/zone/RailSection.tsx packages/desktop/src/renderer/components/Layout.tsx
git commit -m "feat(desktop): add drag context and ghost drop zone highlights"
```

---

## Task 10: Clean Up Old Panel Components and Store Fields

**Files:**
- Delete: `packages/desktop/src/renderer/components/panels/LeftPanel.tsx`
- Delete: `packages/desktop/src/renderer/components/panels/RightPanel.tsx`
- Delete: `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`
- Modify: `packages/desktop/src/renderer/store/ui.ts`
- Modify: `packages/desktop/src/renderer/store/plugins.ts`
- Modify: `packages/desktop/src/__tests__/stores/ui.test.ts`

- [ ] **Step 1: Delete old panel components**

```bash
rm packages/desktop/src/renderer/components/panels/LeftPanel.tsx
rm packages/desktop/src/renderer/components/panels/RightPanel.tsx
rm packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx
```

- [ ] **Step 2: Remove dead imports across the codebase**

Search for imports of `LeftPanel`, `RightPanel`, `BottomPanel` in all files and remove them. Key files to check:
- `App.tsx` (already updated in Task 5)
- `Layout.tsx` (already updated in Task 5)
- Any other file importing these components

Run: `cd packages/desktop && grep -r "LeftPanel\|RightPanel\|BottomPanel" src/renderer/ --include="*.tsx" --include="*.ts" -l`

Fix each file that still references the deleted components.

- [ ] **Step 3: Slim down useUIStore**

Remove from `packages/desktop/src/renderer/store/ui.ts`:
- `panelCollapsed` (moved to `useLayoutStore.collapsed`)
- `panelSizes` (bottom height is in Layout local state; left/right handled by react-resizable-panels)
- `panelVisible` (replaced by `collapsed.bottom`)
- `leftPanelTab` (dead state)
- `rightPanelTab` (dead state)
- `bottomPanelMode` (no longer needed — Preview and Terminal are separate tool windows)
- `togglePanel` (replaced by `useLayoutStore.toggleSide`)
- `setPanelSize` (no longer needed)
- `setPanelVisible` (no longer needed)
- `setLeftPanelTab` (dead)
- `setRightPanelTab` (dead)
- `setBottomPanelMode` (no longer needed)

Keep only non-layout UI state if any remains. If the store becomes empty, delete it entirely and remove all imports.

- [ ] **Step 4: Slim down usePluginLayoutStore**

Remove from `packages/desktop/src/renderer/store/plugins.ts`:
- `activeLeftPanelId` (no longer needed — plugins are tool windows now)
- `activeRightPanelId` (same)
- `setActiveLeftPanel` (same)
- `setActiveRightPanel` (same)

Keep: `activeFullviewId`, `activateFullview`, `contributions`, `actions`, and their registration methods.

- [ ] **Step 5: Update ui.test.ts**

Remove tests for deleted state fields. If the store is deleted entirely, delete the test file too.

- [ ] **Step 6: Typecheck the full desktop package**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success — all dead references removed

- [ ] **Step 7: Run all desktop tests**

Run: `cd packages/desktop && pnpm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(desktop): remove old panel components and dead store fields"
```

---

## Task 11: Add Bottom Zone Drop Targets to Tab Bars

**Files:**
- Modify: `packages/desktop/src/renderer/components/zone/ZoneTabBar.tsx`

- [ ] **Step 1: Make ZoneTabBar a drop target for rail icon drags**

Update `ZoneTabBar.tsx` to accept drops from rail icon drags (data type `application/x-toolwindow`). When a tool window is dropped on a zone's tab bar, it moves to that zone:

```tsx
const moveToolWindow = useLayoutStore((s) => s.moveToolWindow);
const { isDragging, hoveredZone, setHoveredZone } = useDragContext();

const handleExternalDragOver = useCallback((e: React.DragEvent) => {
  if (e.dataTransfer.types.includes('application/x-toolwindow')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoveredZone(zoneId);
  }
}, [zoneId, setHoveredZone]);

const handleExternalDrop = useCallback((e: React.DragEvent) => {
  const toolWindowId = e.dataTransfer.getData('application/x-toolwindow');
  if (toolWindowId) {
    e.preventDefault();
    moveToolWindow(toolWindowId, zoneId);
  }
  setHoveredZone(null);
}, [zoneId, moveToolWindow, setHoveredZone]);
```

Add these handlers to the tab bar container div, alongside the existing tab-reorder handlers. Add a visual highlight when `isDragging && hoveredZone === zoneId`:

```tsx
<div
  className={`
    flex h-7 items-center bg-mf-surface-secondary border-b border-mf-border overflow-x-auto
    ${isDragging && hoveredZone === zoneId ? 'ring-2 ring-inset ring-mf-accent/40' : ''}
  `}
  onDragOver={handleExternalDragOver}
  onDrop={handleExternalDrop}
  onDragLeave={() => setHoveredZone(null)}
>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/zone/ZoneTabBar.tsx
git commit -m "feat(desktop): make zone tab bars accept tool window drops"
```

---

## Task 12: Plugin Tool Window Registration

**Files:**
- Modify: `packages/desktop/src/renderer/store/plugins.ts`
- Modify: `packages/desktop/src/renderer/store/layout.ts`

- [ ] **Step 1: Write test for plugin tool window lifecycle**

Add to `packages/desktop/src/__tests__/stores/layout.test.ts`:

```typescript
describe('plugin tool windows', () => {
  beforeEach(() => {
    resetStore();
  });

  it('registerToolWindow adds plugin to its default zone', () => {
    useLayoutStore.getState().registerToolWindow('plugin:my-panel', 'left-top');
    const state = useLayoutStore.getState();
    expect(state.zones['left-top'].tabs).toContain('plugin:my-panel');
  });

  it('unregisterToolWindow removes plugin from its zone', () => {
    useLayoutStore.getState().registerToolWindow('plugin:my-panel', 'left-top');
    useLayoutStore.getState().unregisterToolWindow('plugin:my-panel');
    const state = useLayoutStore.getState();
    expect(state.zones['left-top'].tabs).not.toContain('plugin:my-panel');
  });

  it('unregisterToolWindow fixes activeTab if it was the removed plugin', () => {
    useLayoutStore.getState().registerToolWindow('plugin:my-panel', 'left-top');
    useLayoutStore.getState().setActiveTab('left-top', 'plugin:my-panel');
    useLayoutStore.getState().unregisterToolWindow('plugin:my-panel');
    const state = useLayoutStore.getState();
    expect(state.zones['left-top'].activeTab).toBe('sessions');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && pnpm vitest run src/__tests__/stores/layout.test.ts`
Expected: FAIL — `registerToolWindow` not yet defined

- [ ] **Step 3: Add registerToolWindow and unregisterToolWindow to layout store**

Add to `packages/desktop/src/renderer/store/layout.ts`:

```typescript
registerToolWindow(toolWindowId: string, defaultZone: ZoneId) {
  set((state) => {
    const zones = JSON.parse(JSON.stringify(state.zones)) as Record<ZoneId, ZoneState>;
    // Check if already placed in some zone (e.g., from persisted state)
    for (const zone of Object.values(zones)) {
      if (zone.tabs.includes(toolWindowId)) return state;
    }
    // Add to default zone
    const target = zones[defaultZone];
    target.tabs.push(toolWindowId);
    if (target.activeTab === null) {
      target.activeTab = toolWindowId;
    }
    return { zones };
  });
},

unregisterToolWindow(toolWindowId: string) {
  set((state) => {
    const zones = JSON.parse(JSON.stringify(state.zones)) as Record<ZoneId, ZoneState>;
    for (const zone of Object.values(zones)) {
      const idx = zone.tabs.indexOf(toolWindowId);
      if (idx !== -1) {
        zone.tabs.splice(idx, 1);
        if (zone.activeTab === toolWindowId) {
          zone.activeTab = zone.tabs[0] ?? null;
        }
        break;
      }
    }
    return { zones };
  });
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && pnpm vitest run src/__tests__/stores/layout.test.ts`
Expected: PASS

- [ ] **Step 5: Update plugin registration to route through layout store**

In `packages/desktop/src/renderer/store/plugins.ts`, when `registerContribution` is called with a zone-based contribution, also call `useLayoutStore.getState().registerToolWindow(...)` and `registerPluginToolWindow(...)` from the tool-windows registry. On `unregisterContribution`, call `unregisterToolWindow` on both.

- [ ] **Step 6: Typecheck and test**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build && cd packages/desktop && pnpm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/store/layout.ts packages/desktop/src/renderer/store/plugins.ts packages/desktop/src/__tests__/stores/layout.test.ts
git commit -m "feat(desktop): plugin tool window registration through layout store"
```

---

## Task 13: Migration from Old Store State

**Files:**
- Modify: `packages/desktop/src/renderer/store/layout.ts`

- [ ] **Step 1: Add migration logic in the persist config**

Add a `migrate` function to the Zustand persist config that handles first-load migration. On version 0 (no stored state), check if old `useUIStore` data exists in localStorage under key `mainframe-ui` and read `panelCollapsed`:

```typescript
persist(
  (set, get) => ({
    // ... existing store ...
  }),
  {
    name: 'mainframe-layout',
    version: 1,
    migrate(persistedState, version) {
      if (version === 0 || !persistedState) {
        // First load — try to read old collapsed state
        try {
          const raw = localStorage.getItem('mainframe-ui');
          if (raw) {
            const old = JSON.parse(raw)?.state;
            if (old?.panelCollapsed) {
              return {
                ...buildDefaultZones(),
                collapsed: {
                  left: old.panelCollapsed.left ?? false,
                  right: old.panelCollapsed.right ?? false,
                  bottom: old.panelCollapsed.bottom ?? true,
                },
              };
            }
          }
        } catch {
          // Ignore parse errors — use defaults
        }
      }
      return persistedState as LayoutState & LayoutActions;
    },
  },
),
```

- [ ] **Step 2: Test migration manually**

Set `localStorage.setItem('mainframe-ui', JSON.stringify({ state: { panelCollapsed: { left: true, right: false, bottom: false } } }))` in a test, clear `mainframe-layout`, then create the store and verify it picks up the old collapsed state.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/store/layout.ts
git commit -m "feat(desktop): migrate collapsed state from old useUIStore on first load"
```

---

## Task 14: Final Integration and Typecheck

**Files:**
- Various — fix any remaining type errors or broken imports

- [ ] **Step 1: Full typecheck**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Fix any failures**

Address each failure individually. Common issues:
- Stale imports of deleted components/stores
- Missing exports from new modules
- Type mismatches between old and new store shapes

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(desktop): resolve remaining type errors and test failures"
```

---

## Task 15: Add Changeset

**Files:**
- Create: `.changeset/<generated-name>.md`

- [ ] **Step 1: Create changeset**

Run: `pnpm changeset`

Select:
- `@qlan-ro/mainframe-desktop` — minor
- `@qlan-ro/mainframe-types` — minor

Message: "IntelliJ-style dockable tool window system with 6 zones, drag-and-drop rearrangement, and full persistence"

- [ ] **Step 2: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for intellij sidepanels"
```
