/**
 * addRunTab — preview tabs are singletons per launch config.
 *
 * Re-launching the same preview config (e.g. via the toolbar run button) must
 * focus the existing preview tab rather than stacking a duplicate. Other kinds
 * (and preview tabs for different configs) still append.
 *
 * Scope-aware dedup (second describe block): once every tab carries a scopeKey
 * the singleton match must require BOTH config name AND scopeKey to match.
 * Same config + different scope → two separate tabs.
 */
import { describe, it, expect } from 'vitest';
import { addRunTab, emptyRun, type RunState, type RunTab } from '../run-pane';

const previewTab = (config: string, id: string, scopeKey?: string): RunTab => ({
  id,
  kind: 'preview',
  title: config,
  config,
  ...(scopeKey !== undefined ? { scopeKey } : {}),
});

const consoleTab = (config: string, id: string, scopeKey?: string): RunTab => ({
  id,
  kind: 'console',
  title: config,
  config,
  ...(scopeKey !== undefined ? { scopeKey } : {}),
});

function tabIds(run: RunState): string[] {
  return run.panes.flatMap((p) => p.tabs.map((t) => t.id));
}

describe('addRunTab — preview dedup', () => {
  it('focuses the existing preview tab instead of appending a duplicate config', () => {
    const first = addRunTab(emptyRun(), previewTab('Preview', 'preview-A'))!;
    const second = addRunTab(first, previewTab('Preview', 'preview-B'))!;

    // No duplicate: still exactly one tab, the original id is kept.
    expect(tabIds(second)).toEqual(['preview-A']);
    // The existing tab is focused.
    expect(second.panes[0]!.active).toBe('preview-A');
  });

  it('appends preview tabs for different configs', () => {
    const first = addRunTab(emptyRun(), previewTab('Preview', 'preview-A'))!;
    const second = addRunTab(first, previewTab('App Tauri Preview', 'preview-B'))!;

    expect(tabIds(second)).toEqual(['preview-A', 'preview-B']);
    expect(second.panes[0]!.active).toBe('preview-B');
  });

  it('opens a distinct tab per config — a console process never reuses another config tab', () => {
    // Regression for the "2nd launch config hijacked the first tab" bug.
    const first = addRunTab(emptyRun(), consoleTab('Core Daemon', 'console-A'))!;
    const second = addRunTab(first, consoleTab('Worker', 'console-B'))!;

    expect(tabIds(second)).toEqual(['console-A', 'console-B']);
    expect(second.panes[0]!.active).toBe('console-B');
  });

  it('focuses the existing console tab when the same process is re-launched', () => {
    const first = addRunTab(emptyRun(), consoleTab('Core Daemon', 'console-A'))!;
    const second = addRunTab(first, consoleTab('Core Daemon', 'console-B'))!;

    expect(tabIds(second)).toEqual(['console-A']);
    expect(second.panes[0]!.active).toBe('console-A');
  });

  it('finds and focuses a duplicate preview living in a second pane', () => {
    const base = addRunTab(emptyRun(), previewTab('Preview', 'preview-A'))!;
    const split: RunState = {
      ...base,
      panes: [base.panes[0]!, { id: 'pane-2', tabs: [previewTab('Other', 'other-1')], active: 'other-1' }],
    };

    const result = addRunTab(split, previewTab('Preview', 'preview-Z'), 'pane-2')!;

    // No new tab; the original preview in pane 0 is focused.
    expect(tabIds(result)).toEqual(['preview-A', 'other-1']);
    expect(result.panes[0]!.active).toBe('preview-A');
  });
});

describe('addRunTab — scope-aware dedup', () => {
  it('same config + same scopeKey → dedups: focuses the existing tab, no new entry', () => {
    const first = addRunTab(emptyRun(), previewTab('dev', 'a', 'proj-A:/ws/a'))!;
    const second = addRunTab(first, previewTab('dev', 'b', 'proj-A:/ws/a'))!;

    // Only the original tab survives; 'b' is discarded.
    expect(tabIds(second)).toEqual(['a']);
    expect(second.panes[0]!.active).toBe('a');
  });

  it('same config + DIFFERENT scopeKey → appends both tabs', () => {
    const first = addRunTab(emptyRun(), previewTab('dev', 'a', 'proj-A:/ws/a'))!;
    const second = addRunTab(first, previewTab('dev', 'b', 'proj-B:/ws/b'))!;

    // Both tabs exist: one per scope.
    expect(tabIds(second)).toEqual(['a', 'b']);
    // The newly-added tab is focused.
    expect(second.panes[0]!.active).toBe('b');
  });

  it('same config, both no scopeKey → still dedups (regression guard)', () => {
    // Tabs without a scopeKey must continue to dedup by config name alone
    // so existing behaviour is not broken by the scope-aware change.
    const first = addRunTab(emptyRun(), previewTab('dev', 'a'))!;
    const second = addRunTab(first, previewTab('dev', 'b'))!;

    expect(tabIds(second)).toEqual(['a']);
    expect(second.panes[0]!.active).toBe('a');
  });

  it('console variant: same config name, different scope → two tabs', () => {
    const first = addRunTab(emptyRun(), consoleTab('dev', 'console-a', 'proj-A:/ws/a'))!;
    const second = addRunTab(first, consoleTab('dev', 'console-b', 'proj-B:/ws/b'))!;

    expect(tabIds(second)).toEqual(['console-a', 'console-b']);
    expect(second.panes[0]!.active).toBe('console-b');
  });

  it('tab for (dev, scope A) in pane 0; adding (dev, scope B) with no paneId appends to pane 0', () => {
    // Ensure the new scope-B tab lands in the default pane (pane 0),
    // not hijacking the scope-A tab's pane focus.
    const first = addRunTab(emptyRun(), previewTab('dev', 'a', 'proj-A:/ws/a'))!;
    // No explicit paneId → defaults to pane 0.
    const second = addRunTab(first, previewTab('dev', 'b', 'proj-B:/ws/b'))!;

    // Both ids appear in pane 0 — the scope-B tab was appended there.
    expect(second.panes).toHaveLength(1);
    expect(tabIds(second)).toEqual(['a', 'b']);
  });
});
