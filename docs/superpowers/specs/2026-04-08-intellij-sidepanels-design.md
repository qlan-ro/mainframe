# IntelliJ-Style Side Panels

## Overview

Replace the current simple 3-column layout with an IntelliJ-style dockable tool window system. Six fixed zones surround a fixed center panel. Tool windows can be dragged between zones, tabbed within zones, and resized. Full state persists across sessions.

## Zone Model

Six dockable zones around a fixed center:

```
+------+-----------+-----------+-----------+------+
|      | LEFT TOP  |           | RIGHT TOP |      |
| L    |           |           |           |  R   |
| e  T |-----------+           +-----------| i  T |
| f  o |           |           |           | g  o |
| t  p | LEFT BOT  |  CENTER   | RIGHT BOT | h  p |
|      |           |  (fixed)  |           | t    |
| R  M |           |           |           |  R M |
| a  i |           |           |           | a  i |
| i  d |           |           |           | i  d |
| l    |           |           |           | l    |
+------+-----------+-----------+-----------+------+
|  B   |       BOTTOM LEFT    | BOTTOM RT |   B  |
+------+-----------------------+-----------+------+
```

- **Center** is fixed — always shows the active chat. Not part of the zone system.
- **File view** stays special — renders in/adjacent to center. Not a tool window (for now).
- **Bottom zone spans full app width** — below both side columns and center.
- **Left-bottom / right-bottom** sit within their side columns, above the bottom zone.

### Zone IDs

```typescript
type ZoneId =
  | 'left-top'
  | 'left-bottom'
  | 'right-top'
  | 'right-bottom'
  | 'bottom-left'
  | 'bottom-right';
```

## Rail Layout

Each rail (left and right) has **three icon sections** plus a **fixed utility area**:

### Left Rail (top to bottom)

| Section | Controls | Icons |
|---------|----------|-------|
| Top (above divider) | `left-top` zone | Sessions |
| Mid (below divider) | `left-bottom` zone | Skills, Agents |
| _(spacer)_ | | |
| Bottom (gravity-pinned) | `bottom-left` zone | Preview |
| _(separator)_ | | |
| Fixed utilities | Modals, not zones | Todos, Settings, Help |

### Right Rail (top to bottom)

| Section | Controls | Icons |
|---------|----------|-------|
| Top (above divider) | `right-top` zone | Files |
| Mid (below divider) | `right-bottom` zone | Context, Changes |
| _(spacer)_ | | |
| Bottom (gravity-pinned) | `bottom-right` zone | Terminal |

### Fixed Utility Buttons

Todos, Settings, and Help are pinned at the bottom of the left rail, below a separator line. They are:

- Not part of the zone system
- Not draggable
- Not dockable
- Open modals or fixed views (same behavior as today)

### Rail Icon Behavior

- **Click** when zone is visible and this tab is active → collapse the whole side/bottom
- **Click** when zone is visible but different tab is active → switch to this tab
- **Click** when side is collapsed → expand and activate this tab
- **Drag** → pick up icon, show ghost drop zones on all rail sections and bottom tab bars

## Component Tree

```
<div className="h-screen flex flex-col">
  <TitleBar />
  <div className="flex-1 flex overflow-hidden">
    <LeftRail />
    <div className="flex-1 flex flex-col">
      <!-- Upper area: side columns + center -->
      <PanelGroup direction="horizontal">
        <Panel>                               <!-- Left Column -->
          <PanelGroup direction="vertical">
            <Panel> <Zone id="left-top" /> </Panel>
            <ResizeHandle />
            <Panel> <Zone id="left-bottom" /> </Panel>
          </PanelGroup>
        </Panel>
        <ResizeHandle />
        <Panel> <CenterPanel /> + FileView </Panel>
        <ResizeHandle />
        <Panel>                               <!-- Right Column -->
          <PanelGroup direction="vertical">
            <Panel> <Zone id="right-top" /> </Panel>
            <ResizeHandle />
            <Panel> <Zone id="right-bottom" /> </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
      <!-- Bottom area: full width, below everything -->
      <BottomResizeHandle />              <!-- custom pointer-capture drag (not inside a PanelGroup) -->
      <PanelGroup direction="horizontal">
        <Panel> <Zone id="bottom-left" /> </Panel>
        <ResizeHandle />
        <Panel> <Zone id="bottom-right" /> </Panel>
      </PanelGroup>
    </div>
    <RightRail />
  </div>
  <StatusBar />
</div>
```

### Collapse Behavior

- When a zone has no tabs → its Panel collapses to 0 (split disappears)
- When both zones in a side column are empty → entire column collapses
- When both bottom-left and bottom-right are empty → bottom area collapses
- Clicking a rail icon on a collapsed side expands it

## State Model

### `useLayoutStore` (Zustand, persisted)

New store that replaces layout-related parts of `useUIStore` and `usePluginLayoutStore`.

```typescript
interface ZoneState {
  tabs: string[];          // ordered tool window IDs
  activeTab: string | null;
}

interface LayoutState {
  zones: Record<ZoneId, ZoneState>;
  collapsed: Record<'left' | 'right' | 'bottom', boolean>;
}
```

Panel sizes are handled by `react-resizable-panels` via `autoSaveId` (stored in localStorage automatically).

### Actions

```typescript
interface LayoutActions {
  // Zone management
  moveToolWindow(toolWindowId: string, targetZone: ZoneId, index?: number): void;
  reorderTab(zoneId: ZoneId, fromIndex: number, toIndex: number): void;
  setActiveTab(zoneId: ZoneId, tabId: string): void;
  removeFromZone(zoneId: ZoneId, toolWindowId: string): void;

  // Collapse
  toggleSide(side: 'left' | 'right' | 'bottom'): void;

  // Plugin registration
  registerToolWindow(toolWindow: ToolWindow): void;
  unregisterToolWindow(id: string): void;

  // Reset
  resetLayout(): void;
}
```

## Tool Window Registry

Static registry for builtins, dynamic registration for plugins.

```typescript
interface ToolWindow {
  id: string;
  label: string;
  icon: ComponentType;
  component: ComponentType;
  defaultZone: ZoneId;
}
```

### Default Assignments

| Tool Window | Default Zone |
|-------------|-------------|
| Sessions | `left-top` |
| Skills | `left-bottom` |
| Agents | `left-bottom` |
| Files | `right-top` |
| Context | `right-bottom` |
| Changes | `right-bottom` |
| Preview | `bottom-left` |
| Terminal | `bottom-right` |

## Zone Component

```typescript
interface ZoneProps {
  id: ZoneId;
}
```

### Rendering

- `tabs.length === 0` → render nothing (Panel collapses)
- `tabs.length >= 1` → render tab bar + active tab's content

### Tab Bar

- Horizontal strip of draggable tabs
- Active tab has bottom border highlight
- Close button on each tab (removes from zone; rail icon becomes dimmed)
- Drag tabs to reorder within the zone

## Drag & Drop

Two mechanisms, both using HTML5 Drag and Drop API (no library).

### 1. Tab Drag (within a zone)

- `dragstart` / `dragover` / `drop` on tab elements
- Dragged tab becomes semi-transparent
- Insertion indicator line appears between tabs
- State change: `reorderTab(zoneId, fromIndex, toIndex)`

### 2. Rail Icon Drag (between zones)

- Drag an icon from any rail section to any other rail section (on either rail)
- Also drag to bottom zone tab bars as drop targets
- Ghost drop zones: translucent highlight overlay on all valid targets during drag
- Hovered target gets brighter highlight + zone label ("Left Top", "Bottom Right", etc.)
- State change: `moveToolWindow(id, targetZone)`

### Constraints

- Cannot drag from tab bar to rail (use rail icons for cross-zone moves)
- Cannot drag to center panel
- Cannot create new zones — only the 6 fixed zones exist

## Plugin Integration

### Plugin Manifest

```json
{
  "ui": {
    "toolWindows": [
      {
        "id": "my-panel",
        "label": "My Panel",
        "icon": "grid",
        "defaultZone": "left-top"
      }
    ]
  }
}
```

Plugin tool windows are first-class: they get rail icons, can be dragged between zones, and persist their position.

## Persistence

### What Gets Persisted

| Data | Storage |
|------|---------|
| Zone assignments (which tool windows in which zones) | `useLayoutStore` (Zustand persist) |
| Tab order within each zone | `useLayoutStore` |
| Active tab per zone | `useLayoutStore` |
| Collapsed state (left/right/bottom) | `useLayoutStore` |
| Panel sizes (all splits) | `react-resizable-panels` autoSaveId (localStorage) |

### What Does NOT Get Persisted

- Component references (resolved from registry at runtime)
- Plugin tool windows that are no longer installed (pruned on load)

### Migration from Old Stores

On first load after upgrade, if `useLayoutStore` has no saved state:

1. Read `useUIStore.panelCollapsed` → set `collapsed`
2. Read `useUIStore.panelSizes` → set initial sizes
3. Build default zone assignments from tool window registry
4. New store takes over; old layout fields in `useUIStore` become unused

### Reset

"Reset Layout" action (accessible from Settings or rail context menu) restores all zone assignments, sizes, and collapsed states to defaults.

## Future Considerations

- **File view as tool window**: Currently stays special in center area. When promoted to a tool window, it registers in the tool window registry like everything else — no architectural changes needed.
- **Split center**: Center could support side-by-side chat tabs in the future — orthogonal to this design.
