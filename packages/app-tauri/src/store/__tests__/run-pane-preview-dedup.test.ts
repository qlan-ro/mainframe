/**
 * addRunTab — preview tabs are singletons per launch config.
 *
 * Re-launching the same preview config (e.g. via the toolbar run button) must
 * focus the existing preview tab rather than stacking a duplicate. Other kinds
 * (and preview tabs for different configs) still append.
 */
import { describe, it, expect } from 'vitest';
import { addRunTab, emptyRun, type RunState, type RunTab } from '../run-pane';

const previewTab = (config: string, id: string): RunTab => ({
  id,
  kind: 'preview',
  title: config,
  config,
});

const consoleTab = (config: string, id: string): RunTab => ({
  id,
  kind: 'console',
  title: config,
  config,
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
      panes: [
        base.panes[0]!,
        { id: 'pane-2', tabs: [previewTab('Other', 'other-1')], active: 'other-1' },
      ],
    };

    const result = addRunTab(split, previewTab('Preview', 'preview-Z'), 'pane-2')!;

    // No new tab; the original preview in pane 0 is focused.
    expect(tabIds(result)).toEqual(['preview-A', 'other-1']);
    expect(result.panes[0]!.active).toBe('preview-A');
  });
});
