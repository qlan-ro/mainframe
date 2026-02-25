# Sandbox Launch UI Redesign

**Goal:** Replace the single "Preview" toggle button in StatusBar with a split button + popover launcher, and merge the log output into the bottom panel as a collapsible strip below the webview.

---

## Status Bar — Split Button

Two clickable zones anchored to the right of the status bar:

```
[▷ Preview][∨]
```

**Left zone `[▷ Preview]`**
- Icon reflects aggregate process state:
  - `▷` — all stopped
  - `⟳` — any starting
  - `■` — any running
  - `▷` (red) — any failed, none running
- Click: starts the `preview: true` process if stopped; stops it if running. Opens the bottom panel.

**Right zone `[∨]`**
- Always opens the popover, regardless of run state.

---

## Popover

Anchored below the `[∨]` chevron. Closes on outside click.

```
┌─────────────────────┐
│ Core Daemon      ▷  │
│ Desktop App      ⟳  │
│ Types Watch      ■  │
├─────────────────────┤
│   Stop all          │
└─────────────────────┘
```

- Each row is fully clickable (name + icon). Clicking starts or stops that process. Popover stays open.
- Icon on the right reflects status:
  - `▷` — stopped (click to start)
  - `⟳` — starting (not interactive)
  - `■` — running (click to stop)
  - `▷` dimmed red — failed (click to retry)
- **Stop all** row at the bottom; dimmed when nothing is running.
- Configs loaded from `launch.json` once on open; icons update live from `processStatuses` in sandbox store.

---

## Bottom Panel

Single panel — no tabs. Webview on top, log strip pinned to the bottom.

```
┌────────────────────────────────────────┐
│ [http://localhost:5173] [↺] [⊕] [📷]  │  ← existing PreviewTab toolbar
├────────────────────────────────────────┤
│                                        │
│              webview                   │
│                                        │
├────────────────────────────────────────┤
│ [Core Daemon ▾]              [∧] [✕]  │  ← log strip header (~28px, always visible)
│ pnpm run dev                           │  ← log output (~150px, only when expanded)
│ > Server running on :5173              │
└────────────────────────────────────────┘
```

**Log strip header** (always visible):
- Left: process selector dropdown — pick which process's logs to view.
- Right: `∧/∨` toggle expands/collapses log output; `✕` clears logs for selected process.

**Log output** (when expanded):
- ~150px height, auto-scrolls to bottom.
- `stderr` lines in red.

**Removed:**
- `LogsTab` component — deleted entirely.
- Tab bar in `BottomPanel` — deleted; `bottomPanelTab` UI store field removed.

---

## Files Affected

| File | Change |
|------|--------|
| `packages/desktop/src/renderer/components/StatusBar.tsx` | Replace "Preview" button with split button + popover |
| `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx` | Remove tab bar; render `PreviewTab` directly |
| `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx` | Add log strip at bottom |
| `packages/desktop/src/renderer/components/sandbox/LogsTab.tsx` | Delete |
| `packages/desktop/src/renderer/store/ui.ts` | Remove `bottomPanelTab` field |
