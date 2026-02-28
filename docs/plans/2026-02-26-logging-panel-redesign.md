# Logging Panel Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the BottomPanel to use tabbed process navigation, with logs expanded by default, a toggle button in the sidebar, and proper handling of empty/running states.

**Architecture:** The BottomPanel will be controlled by a `panelVisible` flag in the UI store (separate from `panelCollapsed.bottom`). When toggled on, it shows a header with process tabs. Process tabs use horizontal buttons instead of a dropdown. Logs are nested inside the expanded area and default to expanded. A minimize button (_) collapses the entire panel. Empty state shows "No processes running" when no processes are active.

**Tech Stack:** React, TypeScript, Tailwind CSS, Pino (logging), Zustand (state management)

---

## Task 1: Add UI Store State for Panel Visibility

**Files:**
- Modify: `packages/desktop/src/renderer/store/ui.ts`

**Step 1: Read the UI store to understand current structure**

Run: `grep -n "panelCollapsed\|panelSizes" packages/desktop/src/renderer/store/ui.ts | head -20`

Expected output shows current panel state management.

**Step 2: Add `panelVisible` state to UI store**

In `ui.ts`, add to the state object:
```typescript
panelVisible: boolean; // Controls whether BottomPanel is shown
```

And add setter method:
```typescript
setPanelVisible: (visible: boolean) => {
  set((s) => ({
    panelVisible: visible,
  }));
},
```

**Step 3: Initialize `panelVisible` to `false` in initial state**

Ensure the store initializes with `panelVisible: false` so panel is hidden by default.

**Step 4: Run typecheck to verify no errors**

Run: `pnpm --filter @mainframe/desktop typecheck`

Expected: No TS errors related to `panelVisible`.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/store/ui.ts
git commit -m "feat(desktop): add panelVisible state to UI store"
```

---

## Task 2: Add Toggle Button to Left Sidebar

**Files:**
- Modify: `packages/desktop/src/renderer/components/Layout.tsx`

**Step 1: Read Layout.tsx to find sidebar/About/Settings buttons**

Run: `grep -n "about\|settings\|About\|Settings" packages/desktop/src/renderer/components/Layout.tsx`

Expected: Identifies where About and Settings buttons are located.

**Step 2: Add toggle button for BottomPanel**

In the sidebar (near About/Settings), add:
```typescript
<div className="flex items-center gap-1 text-xs text-mf-text-secondary">
  {/* Pipe divider */}
  <div className="text-mf-divider">|</div>

  {/* Toggle logs panel button */}
  <button
    onClick={() => setPanelVisible(!panelVisible)}
    className={[
      'px-2 py-1 rounded hover:text-mf-text-primary transition-colors',
      panelVisible ? 'text-mf-text-primary' : 'text-mf-text-secondary',
    ].join(' ')}
    title="Toggle logs panel"
  >
    Logs
  </button>
</div>
```

Get `panelVisible` and `setPanelVisible` from the UI store:
```typescript
const panelVisible = useUIStore((s) => s.panelVisible);
const setPanelVisible = useUIStore((s) => s.setPanelVisible);
```

**Step 3: Run typecheck**

Run: `pnpm --filter @mainframe/desktop typecheck`

Expected: No TS errors.

**Step 4: Run dev server and verify button renders**

Run: `pnpm dev:web` (if testing in web mode) or `pnpm dev:desktop`

Expected: Button appears in left sidebar, text "Logs", changes color on hover.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/Layout.tsx
git commit -m "feat(desktop): add toggle button for logs panel in sidebar"
```

---

## Task 3: Refactor BottomPanel to Respect panelVisible

**Files:**
- Modify: `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`

**Step 1: Read current BottomPanel.tsx**

Run: `wc -l packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`

Expected: Shows file length (currently ~65 lines).

**Step 2: Update BottomPanel to check `panelVisible` state**

Replace the top of the component:
```typescript
export function BottomPanel(): React.ReactElement | null {
  const panelVisible = useUIStore((s) => s.panelVisible);
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const height = useUIStore((s) => s.panelSizes.bottom);
  const setPanelSize = useUIStore((s) => s.setPanelSize);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);

  // ... rest of code

  // Return null if panel not visible (different from collapsed)
  if (!panelVisible) return null;

  // ... rest of component
}
```

**Step 3: Update minimize button to set `panelVisible` to false**

In PreviewTab header, change the minimize button to:
```typescript
<button
  onClick={() => setPanelVisible(false)}
  className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-1"
  title="Minimize logs panel"
>
  _
</button>
```

**Step 4: Run typecheck**

Run: `pnpm --filter @mainframe/desktop typecheck`

Expected: No TS errors.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx
git commit -m "feat(desktop): make BottomPanel respect panelVisible state"
```

---

## Task 4: Add Empty State Message to BottomPanel

**Files:**
- Modify: `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`

**Step 1: Determine when no processes are running**

In `PreviewTab.tsx`, check how `configs` is populated. It contains all configured processes.
Logs have a `name` field that matches process names.

Read line 145-150 of PreviewTab to understand process selection.

**Step 2: Add empty state condition**

In BottomPanel, after checking `panelVisible`, add logic:
```typescript
const configs = /* get from launchConfig */;
const isRunning = configs.some((c) => logsOutput.some((l) => l.name === c.name));
```

Actually, simpler: check if there are any logs at all. If no logs and no running processes, show empty state.

**Step 3: Render empty state when no processes**

In the expanded content area:
```typescript
{configs.length === 0 ? (
  <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
    No processes running
  </div>
) : (
  <PreviewTab />
)}
```

**Step 4: Run dev and verify empty state appears**

Toggle the panel on with no processes running. Should see "No processes running" message.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx
git commit -m "feat(desktop): add empty state message when no processes running"
```

---

## Task 5: Convert Process Selector to Tabbed Interface

**Files:**
- Modify: `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`

**Step 1: Extract process tabs component**

Create a new component or inline tabs in the header. Instead of:
```typescript
<select value={selectedProcess ?? ''} ...>
```

Replace with a horizontal button bar:
```typescript
<div className="flex items-center gap-1 px-2">
  {configs.length === 0 ? (
    <span className="text-xs text-mf-text-secondary">No processes</span>
  ) : (
    configs.map((c) => (
      <button
        key={c.name}
        onClick={() => setSelectedProcess(c.name)}
        className={[
          'px-3 py-1 text-xs rounded border transition-colors',
          selectedProcess === c.name
            ? 'bg-mf-button-bg text-mf-text-primary border-mf-border'
            : 'text-mf-text-secondary hover:text-mf-text-primary border-transparent',
        ].join(' ')}
      >
        {c.name}
      </button>
    ))
  )}
</div>
```

**Step 2: Update header structure**

Change the header from:
```typescript
<div className="flex items-center justify-between px-2 h-7">
  <select>...</select>
  <div className="flex items-center gap-1">
```

To:
```typescript
<div className="flex items-center justify-between px-2 h-7">
  {/* Process tabs */}
  <div className="flex items-center gap-1">
    {/* tabs here */}
  </div>
  <div className="flex items-center gap-1">
    {/* buttons here */}
  </div>
</div>
```

**Step 3: Run typecheck**

Run: `pnpm --filter @mainframe/desktop typecheck`

Expected: No TS errors.

**Step 4: Run dev server and verify tabs render**

Run: `pnpm dev:web` or `pnpm dev:desktop`

Start a process. Tabs should appear in the header for each running process.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx
git commit -m "feat(desktop): replace process dropdown with tabbed navigation"
```

---

## Task 6: Change Log Expansion Default to True

**Files:**
- Modify: `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`

**Step 1: Change initial state**

On line 140, change:
```typescript
const [logExpanded, setLogExpanded] = useState(false);
```

To:
```typescript
const [logExpanded, setLogExpanded] = useState(true);
```

**Step 2: Verify toggle button still works**

The button that toggles logs (line 286) should now start in expanded state.

**Step 3: Run dev and verify logs are expanded by default**

Run: `pnpm dev:web` or `pnpm dev:desktop`

Start a process. Logs should be visible immediately below the webview.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx
git commit -m "feat(desktop): make logs expanded by default"
```

---

## Task 7: Update Minimize Button Icon and Styling

**Files:**
- Modify: `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`

**Step 1: Update minimize button**

Find the line with the expand/collapse button (around line 285-290).

Change the button text from `{logExpanded ? '∨' : '∧'}` to reflect better semantics:
- When expanded: show `∧` (collapse arrow)
- When collapsed: show `∨` (expand arrow)

This is already correct. But update the minimize button for the entire panel to show `_`:

In BottomPanel header, ensure the minimize button shows `_`.

**Step 2: Verify button appears correctly**

Run: `pnpm dev:web` or `pnpm dev:desktop`

Minimize button should show as `_` and collapse the entire panel.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx
git commit -m "feat(desktop): update panel minimize button styling"
```

---

## Task 8: Add "No Preview Available" Fallback

**Files:**
- Modify: `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`

**Step 1: Determine if selected process has preview**

Check if the selected process config has a `preview` flag or similar.

In PreviewTab, after getting `previewConfig`:
```typescript
const previewConfig = configs.find((c) => c.name === selectedProcess);
const hasPreview = previewConfig?.preview === true;
```

**Step 2: Show fallback message if no preview**

Around line 244 where the webview renders, add:
```typescript
{hasPreview ? (
  isElectron ? (
    <webview ref={webviewRef} src={webviewSrc} className="w-full h-full" />
  ) : (
    <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
      Preview panel requires Electron. Use <code className="mx-1">pnpm dev:desktop</code>.
    </div>
  )
) : (
  <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
    No preview available for this process
  </div>
)}
```

**Step 3: Run typecheck**

Run: `pnpm --filter @mainframe/desktop typecheck`

Expected: No TS errors.

**Step 4: Run dev and verify fallback appears**

Start a process without preview enabled. Should see "No preview available" message.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx
git commit -m "feat(desktop): show 'No preview available' for processes without preview"
```

---

## Task 9: Test Full Integration

**Files:**
- Test: `packages/desktop/src/__tests__/components/BottomPanel.test.tsx` (create if needed)

**Step 1: Verify UI store changes compile and work**

Run: `pnpm --filter @mainframe/desktop typecheck && pnpm --filter @mainframe/desktop build`

Expected: No errors.

**Step 2: Run existing tests (if any)**

Run: `pnpm --filter @mainframe/desktop test`

Expected: All tests pass.

**Step 3: Manual testing checklist**

Start the dev server:
Run: `pnpm dev:web` or `pnpm dev:desktop`

Test each scenario:
- [ ] Panel is hidden on initial load
- [ ] Clicking "Logs" toggle button shows panel with "No processes running"
- [ ] Minimize button (_) in header hides panel
- [ ] Clicking "Logs" again shows panel (state preserved)
- [ ] Start a process
- [ ] Panel auto-expands and shows process tabs
- [ ] Logs are visible and expanded by default
- [ ] Can collapse logs with collapse button
- [ ] Can switch between process tabs
- [ ] Process without preview shows "No preview available"
- [ ] Clear logs button works
- [ ] State persists when switching projects

**Step 4: Fix any issues found during testing**

If bugs appear, create focused commits for each fix.

**Step 5: Commit testing notes**

```bash
git add .
git commit -m "test(desktop): verify logging panel redesign works end-to-end"
```

---

## Task 10: Update Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md` (if logging panel documented)
- Check: `CLAUDE.md` for any references

**Step 1: Check if architecture doc mentions BottomPanel**

Run: `grep -n "BottomPanel\|logging\|logs" docs/ARCHITECTURE.md | head -10`

**Step 2: Update if needed**

Add brief notes about the new tabbed process interface and visibility toggle.

**Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: update architecture notes for logging panel redesign"
```

---

## Summary

These 10 tasks implement the complete logging panel redesign:
1. Add UI store state
2. Add sidebar toggle button
3. Respect panel visibility
4. Show empty state
5. Convert dropdown to tabs
6. Logs expanded by default
7. Button styling
8. No preview fallback
9. Integration testing
10. Documentation

Total estimated effort: ~1-2 hours with testing.

---

Plan complete and saved to `docs/plans/2026-02-26-logging-panel-redesign.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
