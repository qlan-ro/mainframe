# Logging Panel Redesign

**Date:** 2026-02-26
**Status:** Design approved

## Overview

Redesign the BottomPanel (logging and preview area) to improve visibility and control. The panel should start hidden, expand when processes run, and provide tabbed navigation for switching between running processes. Logs should expand by default but be independently collapsible.

## Architecture

### Panel Visibility
- Panel is hidden by default (returns `null`)
- Toggled via button in left sidebar (below About/Settings, separated by `|`)
- Auto-expands when any process starts running
- Shows empty state with "No processes running" message when no processes are active
- Minimize button (_) in header collapses the panel entirely
- Panel open/closed state persists per project

### Panel Structure
```
BottomPanel (when visible)
├── Header row (always visible when panel open)
│   ├── Process tabs (horizontal tab bar)
│   │   ├── Tab for each running process
│   │   └── Shows selected process name
│   └── Minimize button (_)
└── Content area
    ├── Preview area (webview or fallback message)
    │   ├── Webview (if preview configured)
    │   └── Or: "No preview available" message
    └── Log output area (expanded by default, independently collapsible)
        ├── Collapse button (∧/∨)
        └── Clear logs button (✕)
```

### Process Tabs
- Replaced dropdown selector with horizontal tab bar
- Each running process gets one tab
- Click tab to switch process view (webview + logs)
- Shows "No processes running" if no active processes

### Log Output
- Displayed below webview
- Expanded by default when panel is visible
- Can be independently collapsed via collapse button
- Auto-scrolls to latest output
- Collapse/expand state persists per project
- Clear button removes logs for selected process

### Empty State
- When user opens panel but no processes are running: show "No processes running" message
- Panel structure visible (header with minimize button)
- Header shows no tabs or empty tab bar
- Minimize button allows collapse even in empty state

### Toggle Button
- New button in left sidebar
- Positioned below About/Settings
- Separated by `|` divider
- Last item in left rail
- Label: something like "Logs" or "Output"
- Reflects panel visibility state (styling indicates open/closed)
- Always enabled (clicking shows empty state if needed)

## State Management

### UI Store
- `panelCollapsed.bottom` — controls whether BottomPanel is visible (currently exists)
- `logExpanded` — moved to per-process state (currently local to PreviewTab)
- New: `selectedProcess` — which process tab is active (currently local to PreviewTab)

### Persistence
- All state saved to UI store
- Survives navigation between projects
- Per-project scoping via `activeProjectId`

## Key Changes

### Components affected
- `Layout.tsx` — add toggle button in left sidebar
- `BottomPanel.tsx` — restructure for tab-based navigation, handle empty state
- `PreviewTab.tsx` — refactor to work within tabbed context, show empty state

### Behavior changes
1. Logs are expanded by default (not collapsed)
2. Process selector becomes tabbed interface
3. Entire panel is collapsible via minimize button
4. Panel has empty state when no processes running
5. Toggle button in sidebar for manual control
6. Minimize button shows `_` symbol (not `∧`)

## Success Criteria

- ✅ BottomPanel hidden by default
- ✅ Toggle button appears in left sidebar below About/Settings
- ✅ Clicking toggle shows panel with "No processes running" message
- ✅ Minimize button (_) visible in header
- ✅ Logs show expanded by default when process running
- ✅ Process tabs allow switching between running processes
- ✅ Empty state displays when no processes active
- ✅ "No preview available" message shows for processes without preview
- ✅ Panel state persists per project
- ✅ Logs collapse/expand state persists per project
