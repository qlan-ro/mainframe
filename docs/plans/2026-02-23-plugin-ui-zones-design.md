# Plugin UI Zones — Architecture Design

**Date:** 2026-02-23
**Status:** Approved
**Branch split:** infrastructure → `feat/plugin-system`, todos migration → `feat/todo-kanban-plugin`

---

## 1. Problem

The current plugin system has no structured model for how plugins contribute UI. The todos builtin hardcodes its own tab type in the tabs store, a dedicated button in ProjectRail, and a branch in CenterPanel. Every future plugin would need the same bespoke wiring. This does not scale.

The fix is a first-class zone model: plugins declare where they live, the shell routes accordingly, and no per-plugin desktop code is needed outside of one registry entry.

---

## 2. Layout Zones

The app content area sits between two always-visible chrome elements (TitleBar, ProjectRail/LeftRail) and is divided into named zones.

```
┌──────────────────────────────────────────────────────────────┐
│  TitleBar: [lights] [▾ project]  [search ⌘F]  [📋][🔬][...] │
│                                               ↑ fullview zone │
├───┬─────────────┬──────────────────┬──────────────────────┬──┤
│   │             │                  │                      │  │
│ L │  LeftPanel  │   CenterPanel    │     RightPanel       │ R│
│ e │             │                  │                      │ i│
│ f │ left-panel  │  (chat + center  │  right-panel         │ g│
│ t │  OR tabs    │   plugin tabs)   │   OR right-tab       │ h│
│   │             │                  │                      │ t│
│ R │             │                  │                      │  │
│ a │             │                  │                      │ R│
│ i │             │                  │                      │ a│
│ l │             │                  │                      │ i│
│   │             │                  │                      │ l│
└───┴─────────────┴──────────────────┴──────────────────────┴──┘
```

### Zone taxonomy

| Zone | What the plugin occupies | Trigger location |
|---|---|---|
| `fullview` | Entire Left + Center + Right area | Icon in TitleBar (right section) |
| `left-panel` | Entire LeftPanel | Icon in Left Rail |
| `right-panel` | Entire RightPanel | Icon in Right Rail |
| `left-tab` | A tab within LeftPanel's tab strip | The tab itself |
| `right-tab` | A tab within RightPanel's tab strip | The tab itself |

**Rules:**
- TitleBar and Left Rail always stay visible — they are global chrome.
- `fullview` replaces Left + Center + Right; Left Rail and Right Rail stay mounted.
- `left-panel` and `right-panel` are independent — both can be active simultaneously.
- `left-tab` and `right-tab` are additive: they append tabs to the existing strip and are always present once registered. No rail button.
- Trigger location is fully derived from `zone` — no separate `trigger` field in the manifest.

---

## 3. Shell Redesign

### 3.1 Left Rail (redesigned ProjectRail)

Project switching moves out of the rail entirely — the project name in TitleBar becomes a clickable dropdown.

Left Rail becomes a pure activity bar:
- Top: **Sessions icon** (always present, default selected — shows current Sessions/Skills/Agents content)
- Middle: `left-panel` plugin icons (registered at load time)
- Bottom: Settings, Help (unchanged)
- Active icon = `activeLeftPanelId ?? 'sessions'`

### 3.2 Right Rail (new)

Mirrors Left Rail on the right edge:
- Top: **Context icon** (always present, default selected — shows current Context/Files/Changes content)
- Middle: `right-panel` plugin icons
- Rendered only when at least one `right-panel` plugin is registered or by default when the right panel is open.

### 3.3 TitleBar

Two changes:
1. Project name becomes a button — click opens a project picker dropdown.
2. Right section renders `fullview` plugin icons from the plugin layout store.

### 3.4 LeftPanel

Two-mode rendering driven by `activeLeftPanelId`:

```tsx
if (activeLeftPanelId) {
  return <PluginView pluginId={activeLeftPanelId} />;
}
// else: normal tabbed content with left-tab contributions appended
```

### 3.5 RightPanel

Same pattern, driven by `activeRightPanelId`.

### 3.6 Layout — fullview switch

When `activeFullviewId` is set, the resizable panel group collapses to a single panel:

```tsx
{activeFullviewId ? (
  <Panel id="center">
    <PluginView pluginId={activeFullviewId} />
  </Panel>
) : (
  <>left + center + right panels</>
)}
```

Clicking the active fullview icon again toggles it off and restores the previous layout.

---

## 4. Manifest Contract

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

`zone` is required. `label` is always required. `icon` is required for `fullview`, `left-panel`, and `right-panel`; optional for `left-tab` and `right-tab` (which show only text in the tab strip).

Plugin registers at activation time via `ctx.ui.addPanel()`:

```typescript
ctx.ui.addPanel({ zone: 'fullview', label: 'Tasks', icon: 'square-check' });
```

The daemon emits `plugin.panel.registered` over WS. The desktop plugin store picks it up and updates the rail/TitleBar icons automatically.

---

## 5. Plugin Layout Store

```typescript
// packages/desktop/src/renderer/store/plugins.ts
interface PluginUIContribution {
  pluginId: string;
  zone: UIZone;
  label: string;
  icon?: string;
}

interface PluginLayoutState {
  contributions: PluginUIContribution[];
  activeFullviewId: string | null;      // null = normal layout
  activeLeftPanelId: string | null;     // null = default Sessions panel
  activeRightPanelId: string | null;    // null = default Context panel

  registerContribution(c: PluginUIContribution): void;
  unregisterContribution(pluginId: string): void;
  activateFullview(pluginId: string): void;
  deactivateFullview(): void;
  setActiveLeftPanel(pluginId: string | null): void;
  setActiveRightPanel(pluginId: string | null): void;
}
```

**Activation transitions:**
- Clicking a Left Rail plugin icon → `setActiveLeftPanel(pluginId)`; clears `activeFullviewId`.
- Clicking Sessions icon → `setActiveLeftPanel(null)`.
- Clicking a Right Rail plugin icon → `setActiveRightPanel(pluginId)`.
- Clicking Context icon → `setActiveRightPanel(null)`.
- Clicking a TitleBar fullview icon → toggle `activeFullviewId` (set if null, null if already set).

---

## 6. Rendering Model

A single `PluginView` component handles all plugin rendering:

```typescript
// components/plugins/PluginView.tsx
const BUILTIN_COMPONENTS: Record<string, React.ComponentType> = {
  todos: TodosPanel,
  // future builtins registered here
};

function PluginView({ pluginId }: { pluginId: string }) {
  const Component = BUILTIN_COMPONENTS[pluginId];
  return (
    <ErrorBoundary fallback={<PluginError pluginId={pluginId} />}>
      {Component
        ? <Component />
        : <PluginESMView pluginId={pluginId} />}
    </ErrorBoundary>
  );
}
```

**Builtins** ship as in-tree React components, pre-registered in `BUILTIN_COMPONENTS` at bundle time.

**External plugins** export a default React component from `ui.mjs`. The app loads it with a dynamic `import()` and registers it into `BUILTIN_COMPONENTS` at plugin load time. Both paths converge at `PluginView` — callers do not distinguish between them.

Iframe / `<webview>` isolation is deferred. The consent model already establishes trust — a plugin whose backend runs in Node.js with filesystem access is not made meaningfully safer by sandboxing its UI.

---

## 7. Todos Plugin Migration

The todos plugin is the reference migration that validates the entire design.

**Remove from `feat/todo-kanban-plugin`:**
- `TodosTab` type from `store/tabs.ts`
- `openTodosTab()` action from tabs store
- `SquareCheck` Tasks button from ProjectRail
- `activePrimaryTab.type === 'todos'` branch in `CenterPanel.tsx`
- `migrateSnapshot` filter allowing `'todos'` type

**Add on `feat/todo-kanban-plugin`:**
- `"ui": { "zone": "fullview", "label": "Tasks", "icon": "square-check" }` in `manifest.json`
- `ctx.ui.addPanel(...)` call in `activate()`
- `todos: TodosPanel` entry in `BUILTIN_COMPONENTS`

After migration, no desktop file mentions "todos" except `PluginView.tsx`'s registry entry. The routing is entirely data-driven.

---

## 8. Future Work

| Feature | When |
|---|---|
| User rearrangement (drag plugin to different zone) | After first external plugin ships |
| Sub-panel splits (left-panel-top, left-panel-bottom) | When a plugin needs it |
| Right Rail persistence (remember active right panel) | With user rearrangement |
| Iframe / webview isolation for untrusted plugins | When plugin marketplace launches |
| `center-tab` zone (plugin tab alongside chat tabs) | When a use case arises |
| Hotkey-only trigger (no rail button) | When a plugin needs it |

---

## 9. File Map

### Infrastructure (`feat/plugin-system`)

**New:**
```
packages/desktop/src/renderer/
  store/plugins.ts                      ← plugin layout store (Zustand)
  components/LeftRail.tsx               ← redesigned ProjectRail
  components/RightRail.tsx              ← new right activity bar
  components/plugins/PluginView.tsx     ← unified render entry point
```

**Modified:**
```
packages/types/src/plugin.ts
  → UIZone type
  → PluginUIContribution: add zone, label, icon fields
  → PluginUIContext.addPanel: accept zone
  → WS event shapes: plugin.panel.registered / plugin.panel.unregistered

packages/core/src/plugins/ui-context.ts
  → addPanel records zone, emits updated WS event shape

packages/desktop/src/renderer/components/
  Layout.tsx            → mount LeftRail + RightRail, fullview switching
  TitleBar.tsx          → project dropdown + fullview icons
  panels/LeftPanel.tsx  → activeLeftPanelId mode + left-tab contributions
  panels/RightPanel.tsx → activeRightPanelId mode + right-tab contributions
```

**Deleted:**
```
packages/desktop/src/renderer/components/ProjectRail.tsx  ← replaced by LeftRail.tsx
```

### Todos migration (`feat/todo-kanban-plugin`)

**Modified:**
```
packages/core/src/plugins/builtin/todos/manifest.json  → add "ui" field
packages/core/src/plugins/builtin/todos/index.ts       → ctx.ui.addPanel(...)
packages/desktop/src/renderer/components/plugins/PluginView.tsx → add todos entry
packages/desktop/src/renderer/store/tabs.ts            → remove TodosTab, openTodosTab
packages/desktop/src/renderer/components/center/CenterPanel.tsx → remove todos branch
packages/desktop/src/renderer/components/ProjectRail.tsx → remove SquareCheck button
  (already deleted above — this change lands when todo branch rebases onto plugin-system)
```
