# Move File View Collapse/Expand Button

## Problem

The collapse/expand button for the file view pane sits in the sidebar's tab bar header (`Context | Files | Changes | ... | ◀`). It feels disconnected from the file view it controls.

## Design

Two-state approach: the button lives on the file view pane itself, and a thin edge strip appears when collapsed.

### Expanded state — collapse button in FileViewHeader

Add a `PanelLeftClose` icon button to the right edge of `FileViewHeader`, after the diff stats. Import `toggleFileViewCollapsed` from `useTabsStore`.

```
┌──────────────────────────────────────────────────┐
│ 📄 index.ts  src/renderer/   ←spacer→  +3 -1  ◀ │
├──────────────────────────────────────────────────┤
│                file content                      │
└──────────────────────────────────────────────────┘
```

### Collapsed state — thin expand strip

Instead of hiding the file view to `w-0`, render a `w-7 shrink-0` vertical strip with a centered `PanelLeftOpen` icon. Clicking it calls `toggleFileViewCollapsed()`.

```
┌──┐┊┌──────────────────┐
│  │┊│ Context Files ... │
│ ▶│┊│  sidebar content  │
└──┘┊└──────────────────┘
```

Strip styling: `w-7 shrink-0 flex items-center justify-center border-r border-mf-divider cursor-pointer`, icon has standard hover state.

The sidebar div next to the strip uses `flex-1 min-w-0` (not `width: 100%`) so it shares space correctly with the strip.

### Removed

- The toggle button in `RightPanel.tsx` `TabsList` (lines 125–137) is deleted.
- The `toggleMode` variable (lines 29–30) becomes dead code and is deleted.
- The `PanelLeftOpen`/`PanelLeftClose` imports move out of `RightPanel.tsx`.

## Files Changed

| File | Change |
|------|--------|
| `FileViewHeader.tsx` | Add `toggleFileViewCollapsed` store selector; add collapse button at right edge |
| `RightPanel.tsx` | Remove toggle button + `toggleMode` from TabsList; replace `w-0` hidden state with expand strip; sidebar uses `flex-1` when collapsed instead of `width: 100%` |
| `Layout.tsx` | Change `hasFileView` to `fileView != null` (remove `&& !fileViewCollapsed`) so the right panel stays wide when collapsed with the strip visible |

## Edge Cases

- **No file view open**: No strip or button rendered (unchanged behavior).
- **Plugin right panel active**: `RightPanel` early-returns with `PluginView` — no strip rendered (unchanged).
- **Resize handle**: Hidden when collapsed (existing behavior), strip takes its place visually.
