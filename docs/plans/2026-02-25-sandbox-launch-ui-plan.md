# Sandbox Launch UI Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the "Preview" toggle button in StatusBar with a split button + popover launcher, and merge log output into the bottom panel as a collapsible strip below the webview.

**Architecture:** UI-only changes in `@mainframe/desktop`. No backend changes needed — process start/stop already works via `startLaunchConfig`/`stopLaunchConfig` in `lib/launch.ts`. Process statuses flow in via WebSocket events into the sandbox Zustand store.

**Tech Stack:** React 18, TypeScript strict/NodeNext, Zustand, Tailwind CSS

---

### Task 1: Add `clearLogsForProcess` to sandbox store

**Files:**
- Modify: `packages/desktop/src/renderer/store/sandbox.ts`

**Context:** The log strip's `✕` button clears logs for the selected process only. The existing `clearLogs` clears all. Add a targeted action.

**Step 1: Read the file**

Read `packages/desktop/src/renderer/store/sandbox.ts`. The `SandboxState` interface and `create()` call are both there.

**Step 2: Add to the interface**

In `SandboxState`, after `clearLogs`:
```typescript
clearLogsForProcess: (name: string) => void;
```

**Step 3: Add the implementation**

In the `create()` call, after `clearLogs`:
```typescript
clearLogsForProcess: (name) =>
  set((state) => ({ logsOutput: state.logsOutput.filter((l) => l.name !== name) })),
```

**Step 4: Typecheck**
```bash
pnpm --filter @mainframe/desktop build 2>&1 | tail -5
```
Expected: no errors.

**Step 5: Commit**
```bash
git add packages/desktop/src/renderer/store/sandbox.ts
git commit -m "feat(desktop): add clearLogsForProcess to sandbox store"
```

---

### Task 2: Extract `useLaunchConfig` hook

**Files:**
- Create: `packages/desktop/src/renderer/hooks/useLaunchConfig.ts`

**Context:** Three components need `launch.json` for the active project: `PreviewTab`, `LaunchPopover` (new), and `StatusBar` (new). Extract once rather than duplicating the `readFile` + parse logic three times. The hooks directory already exists at `packages/desktop/src/renderer/hooks/`.

**Step 1: Create the hook**

Create `packages/desktop/src/renderer/hooks/useLaunchConfig.ts`:
```typescript
import { useEffect, useState } from 'react';
import type { LaunchConfig } from '@mainframe/types';
import { useProjectsStore } from '../store/projects';

export function useLaunchConfig(): LaunchConfig | null {
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );
  const [config, setConfig] = useState<LaunchConfig | null>(null);

  useEffect(() => {
    if (!activeProject) {
      setConfig(null);
      return;
    }
    void window.mainframe
      .readFile(`${activeProject.path}/.mainframe/launch.json`)
      .then((content) => {
        if (!content) { setConfig(null); return; }
        setConfig(JSON.parse(content) as LaunchConfig);
      })
      .catch(() => setConfig(null));
  }, [activeProject?.id]);

  return config;
}
```

**Step 2: Typecheck**
```bash
pnpm --filter @mainframe/desktop build 2>&1 | tail -5
```
Expected: no errors.

**Step 3: Commit**
```bash
git add packages/desktop/src/renderer/hooks/useLaunchConfig.ts
git commit -m "feat(desktop): add useLaunchConfig hook"
```

---

### Task 3: Create `LaunchPopover` component

**Files:**
- Create: `packages/desktop/src/renderer/components/sandbox/LaunchPopover.tsx`

**Context:** The popover opens below the `∨` chevron in StatusBar. It lists all processes from `launch.json` with a status icon on the right. Clicking a row starts or stops that process (popover stays open). "Stop all" at the bottom is disabled when nothing is running. Closes on outside click.

**Step 1: Create the component**

Create `packages/desktop/src/renderer/components/sandbox/LaunchPopover.tsx`:
```typescript
import React, { useEffect } from 'react';
import { useSandboxStore } from '../../store/sandbox';
import { useProjectsStore } from '../../store/projects';
import { startLaunchConfig, stopLaunchConfig } from '../../lib/launch';
import { useLaunchConfig } from '../../hooks/useLaunchConfig';
import type { LaunchConfiguration } from '@mainframe/types';

interface Props {
  onClose: () => void;
}

function processIcon(status: string, isFailed: boolean): React.ReactElement {
  if (status === 'starting') return <span className="text-yellow-400">⟳</span>;
  if (status === 'running') return <span className="text-mf-text-secondary">■</span>;
  if (isFailed) return <span className="text-red-400 opacity-60">▷</span>;
  return <span className="text-mf-text-secondary">▷</span>;
}

export function LaunchPopover({ onClose }: Props): React.ReactElement {
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );
  const launchConfig = useLaunchConfig();
  const processStatuses = useSandboxStore((s) => s.processStatuses);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-launch-popover]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleRowClick = async (config: LaunchConfiguration) => {
    if (!activeProject) return;
    const status = processStatuses[config.name] ?? 'stopped';
    if (status === 'starting') return;
    try {
      if (status === 'running') {
        await stopLaunchConfig(activeProject.id, config.name);
      } else {
        await startLaunchConfig(activeProject.id, config);
      }
    } catch (err) {
      console.warn('[sandbox] process toggle failed', err);
    }
  };

  const handleStopAll = async () => {
    if (!activeProject || !launchConfig) return;
    try {
      await Promise.all(
        launchConfig.configurations.map((c) => stopLaunchConfig(activeProject.id, c.name)),
      );
    } catch (err) {
      console.warn('[sandbox] stop all failed', err);
    }
  };

  const configs = launchConfig?.configurations ?? [];
  const anyRunning = configs.some((c) => {
    const s = processStatuses[c.name] ?? 'stopped';
    return s === 'running' || s === 'starting';
  });

  return (
    <div
      data-launch-popover
      className="absolute right-0 bottom-7 w-52 bg-mf-panel-bg border border-mf-divider rounded shadow-lg z-50 py-1"
    >
      {configs.length === 0 ? (
        <div className="px-3 py-2 text-xs text-mf-text-secondary">No launch.json found.</div>
      ) : (
        <>
          {configs.map((c) => {
            const status = processStatuses[c.name] ?? 'stopped';
            return (
              <button
                key={c.name}
                onClick={() => void handleRowClick(c)}
                disabled={status === 'starting'}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-mf-text-primary hover:bg-mf-hover disabled:opacity-50 disabled:cursor-default"
              >
                <span>{c.name}</span>
                {processIcon(status, status === 'failed')}
              </button>
            );
          })}
          <div className="border-t border-mf-divider my-1" />
          <button
            onClick={() => void handleStopAll()}
            disabled={!anyRunning}
            className="w-full text-left px-3 py-1.5 text-xs text-mf-text-secondary hover:bg-mf-hover disabled:opacity-40 disabled:cursor-default"
          >
            Stop all
          </button>
        </>
      )}
    </div>
  );
}
```

**Step 2: Typecheck**
```bash
pnpm --filter @mainframe/desktop build 2>&1 | tail -5
```
Expected: no errors.

**Step 3: Commit**
```bash
git add packages/desktop/src/renderer/components/sandbox/LaunchPopover.tsx
git commit -m "feat(desktop): add LaunchPopover component"
```

---

### Task 4: Replace StatusBar "Preview" button with split button

**Files:**
- Modify: `packages/desktop/src/renderer/components/StatusBar.tsx`

**Context:** The current right side has a single `<button onClick={() => togglePanel('bottom')}>Preview</button>`. Replace with a split button: left zone (`[▷ Preview]`) starts/stops the `preview: true` process and opens the panel; right zone (`[∨]`) opens `LaunchPopover`.

The aggregate icon in the left zone reflects all process statuses:
- `▷` — all stopped (or no config)
- `⟳` — any starting
- `■` — any running

**Step 1: Read the current file**

Read `packages/desktop/src/renderer/components/StatusBar.tsx`. Note the existing imports and hooks.

**Step 2: Add imports**

After the existing imports, add any that are missing (check first to avoid duplicates):
```typescript
import { useState, useCallback } from 'react'; // useState may not be there yet
import { LaunchPopover } from './sandbox/LaunchPopover';
import { useLaunchConfig } from '../hooks/useLaunchConfig';
import { useSandboxStore } from '../store/sandbox';
import { startLaunchConfig, stopLaunchConfig } from '../lib/launch';
import { useProjectsStore } from '../store/projects';
```

**Step 3: Add state and logic inside the `StatusBar` component body**

Add after the existing hooks (after the `pollRef` and `counts` block):
```typescript
const [popoverOpen, setPopoverOpen] = useState(false);
const launchConfig = useLaunchConfig();
const processStatuses = useSandboxStore((s) => s.processStatuses);
const panelCollapsed = useUIStore((s) => s.panelCollapsed);

const aggregateIcon = (() => {
  const statuses = (launchConfig?.configurations ?? []).map(
    (c) => processStatuses[c.name] ?? 'stopped',
  );
  if (statuses.some((s) => s === 'starting')) return '⟳';
  if (statuses.some((s) => s === 'running')) return '■';
  return '▷';
})();

const previewConfig = launchConfig?.configurations.find((c) => c.preview) ?? null;

const handlePreviewClick = useCallback(async () => {
  // Read activeProjectId directly from store to avoid adding it as a dep
  const projectId = useProjectsStore.getState().activeProjectId;
  if (!projectId || !previewConfig) {
    togglePanel('bottom');
    return;
  }
  const status = processStatuses[previewConfig.name] ?? 'stopped';
  try {
    if (status === 'running' || status === 'starting') {
      await stopLaunchConfig(projectId, previewConfig.name);
    } else {
      await startLaunchConfig(projectId, previewConfig);
      if (panelCollapsed.bottom) togglePanel('bottom');
    }
  } catch (err) {
    console.warn('[sandbox] preview toggle failed', err);
  }
}, [previewConfig, processStatuses, panelCollapsed, togglePanel]);
```

**Step 4: Replace the old "Preview" button**

Find:
```typescript
<button
  onClick={() => togglePanel('bottom')}
  className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-2 py-0.5 rounded"
>
  Preview
</button>
```

Replace with:
```typescript
<div className="relative flex items-center">
  <button
    onClick={() => void handlePreviewClick()}
    className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-2 py-0.5 rounded-l border-r border-mf-divider"
    title="Start/stop preview"
  >
    {aggregateIcon} Preview
  </button>
  <button
    onClick={() => setPopoverOpen((o) => !o)}
    className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-1.5 py-0.5 rounded-r"
    title="Launch configurations"
  >
    ∨
  </button>
  {popoverOpen && <LaunchPopover onClose={() => setPopoverOpen(false)} />}
</div>
```

**Step 5: Typecheck**
```bash
pnpm --filter @mainframe/desktop build 2>&1 | tail -5
```
Expected: no errors.

**Step 6: Commit**
```bash
git add packages/desktop/src/renderer/components/StatusBar.tsx
git commit -m "feat(desktop): replace Preview button with split button launcher"
```

---

### Task 5: Delete LogsTab and simplify BottomPanel + ui store

**Files:**
- Delete: `packages/desktop/src/renderer/components/sandbox/LogsTab.tsx`
- Modify: `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`
- Modify: `packages/desktop/src/renderer/store/ui.ts`

**Context:** LogsTab is replaced by the log strip in PreviewTab (Task 6). BottomPanel no longer needs tabs — it renders PreviewTab directly. `bottomPanelTab` in the ui store is unused.

**Step 1: Delete LogsTab**
```bash
git rm packages/desktop/src/renderer/components/sandbox/LogsTab.tsx
```

**Step 2: Remove `bottomPanelTab` from the ui store**

Read `packages/desktop/src/renderer/store/ui.ts`. Remove these four things:
- From `UIState` interface: `bottomPanelTab: 'preview' | 'logs';`
- From `UIState` interface: `setBottomPanelTab: (tab: UIState['bottomPanelTab']) => void;`
- From `create()` initial state: `bottomPanelTab: 'preview',`
- From `create()` implementation: `setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),`

**Step 3: Rewrite BottomPanel**

Replace the entire content of `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`:
```typescript
import React from 'react';
import { useUIStore } from '../../store/ui';
import { PreviewTab } from './PreviewTab';

export function BottomPanel(): React.ReactElement | null {
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  if (panelCollapsed.bottom) return null;

  return (
    <div className="w-full flex flex-col bg-mf-panel-bg border-t border-mf-divider" style={{ height: 320 }}>
      <PreviewTab />
    </div>
  );
}
```

**Step 4: Typecheck**
```bash
pnpm --filter @mainframe/desktop build 2>&1 | tail -5
```
Expected: no errors and no remaining references to `bottomPanelTab`, `setBottomPanelTab`, or `LogsTab`.

**Step 5: Commit**
```bash
git add packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx \
        packages/desktop/src/renderer/store/ui.ts
git commit -m "refactor(desktop): remove LogsTab, simplify BottomPanel to single panel"
```

---

### Task 6: Add log strip to PreviewTab

**Files:**
- Modify: `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`

**Context:** The log strip sits at the very bottom of the PreviewTab layout. It has an always-visible header (~28px) containing a process selector `<select>` on the left, and expand/clear buttons on the right. When expanded, a 150px scrollable log area appears above the header (inside the strip).

**Step 1: Read the current file**

Read `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`. Note the existing imports and the `useEffect` that loads `launch.json`.

**Step 2: Replace imports**

Remove:
```typescript
import type { LaunchConfig } from '@mainframe/types';
import { useProjectsStore } from '../../store/projects';
```

Add:
```typescript
import { useLaunchConfig } from '../../hooks/useLaunchConfig';
```

Keep `useSandboxStore` — it's now also used for `logsOutput` and `clearLogsForProcess`.

**Step 3: Replace launch.json loading with the hook**

Remove the `useEffect` that reads `launch.json` and replace the `url` initialization.

Current state declarations to change:
```typescript
// REMOVE this useEffect entirely:
useEffect(() => {
  if (!activeProject) return;
  void window.mainframe
    .readFile(...)
    ...
}, [activeProject?.id]);

// REMOVE:
const activeProject = useProjectsStore(...)
```

Add after the existing hooks at the top of the component:
```typescript
const launchConfig = useLaunchConfig();
const configs = launchConfig?.configurations ?? [];

// Derive preview URL from config
const previewUrl = (() => {
  const preview = configs.find((c) => c.preview);
  if (!preview) return 'about:blank';
  return preview.url ?? (preview.port ? `http://localhost:${preview.port}` : 'about:blank');
})();
```

Update the `url` state to sync from `previewUrl`:
```typescript
// Change initialization from useState('about:blank') — keep that
// Add this effect after:
useEffect(() => {
  if (previewUrl !== 'about:blank') setUrl(previewUrl);
}, [previewUrl]);
```

**Step 4: Add log strip state**

Add after the `url` state and the new `previewUrl` effect:
```typescript
const [logExpanded, setLogExpanded] = useState(false);
const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
const { logsOutput, clearLogsForProcess } = useSandboxStore();
const logRef = useRef<HTMLDivElement>(null);

// Auto-select first process when configs load
useEffect(() => {
  if (configs.length > 0 && !selectedProcess) {
    setSelectedProcess(configs[0]!.name);
  }
}, [configs, selectedProcess]);

// Auto-scroll logs
useEffect(() => {
  if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
}, [logsOutput]);

const filteredLogs = selectedProcess
  ? logsOutput.filter((l) => l.name === selectedProcess)
  : logsOutput;
```

**Step 5: Update the JSX**

Change the webview wrapper div from:
```typescript
<div className="flex-1 overflow-hidden">
```
to:
```typescript
<div className="flex-1 overflow-hidden min-h-0">
```
(This prevents flex children from ignoring the shrink constraint.)

After the closing `</div>` of the webview wrapper, add the log strip:
```typescript
{/* Log strip */}
<div className="border-t border-mf-divider shrink-0 bg-mf-app-bg">
  {/* Header */}
  <div className="flex items-center justify-between px-2 h-7">
    <select
      value={selectedProcess ?? ''}
      onChange={(e) => setSelectedProcess(e.target.value || null)}
      className="text-xs bg-transparent text-mf-text-secondary border-none outline-none cursor-pointer max-w-[160px]"
    >
      {configs.length === 0 && <option value="">No processes</option>}
      {configs.map((c) => (
        <option key={c.name} value={c.name}>{c.name}</option>
      ))}
    </select>
    <div className="flex items-center gap-1">
      <button
        onClick={() => setLogExpanded((v) => !v)}
        className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-1"
        title={logExpanded ? 'Collapse logs' : 'Expand logs'}
      >
        {logExpanded ? '∨' : '∧'}
      </button>
      <button
        onClick={() => { if (selectedProcess) clearLogsForProcess(selectedProcess); }}
        disabled={!selectedProcess}
        className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-1 disabled:opacity-40"
        title="Clear logs"
      >
        ✕
      </button>
    </div>
  </div>
  {/* Log output */}
  {logExpanded && (
    <div
      ref={logRef}
      style={{ height: 150 }}
      className="overflow-y-auto px-2 pb-2 font-mono text-xs text-mf-text-secondary"
    >
      {filteredLogs.length === 0 ? (
        <span>No output yet.</span>
      ) : (
        filteredLogs.map((l, i) => (
          <div
            key={`${i}-${l.name}-${l.stream}`}
            className={l.stream === 'stderr' ? 'text-red-400' : ''}
          >
            {l.data}
          </div>
        ))
      )}
    </div>
  )}
</div>
```

**Step 6: Typecheck**
```bash
pnpm --filter @mainframe/desktop build 2>&1 | tail -5
```
Expected: no errors.

**Step 7: Commit**
```bash
git add packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx
git commit -m "feat(desktop): add log strip to PreviewTab"
```

---

### Task 7: Final typecheck and test run

**Step 1: Full build**
```bash
pnpm --filter @mainframe/desktop build 2>&1 | tail -10
```
Expected: clean build, no TypeScript errors.

**Step 2: Run desktop tests**
```bash
pnpm --filter @mainframe/desktop test 2>&1 | tail -20
```
Expected: all tests pass (no desktop component tests exist, but the build itself is the verification).

**Step 3: Commit if any fixups were needed**
```bash
git add -p
git commit -m "fix(desktop): address typecheck issues in sandbox launch UI"
```
