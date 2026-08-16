/**
 * WorkspaceTabPill — the file-tab affordances the merge added: an italic title
 * for the preview slot and double-click to promote. (The type glyphs and the
 * launch Stop are covered by the strip's test; the tab-drag gesture died with
 * the surface-drag system, 2026-08-12.)
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { WorkspaceTabPill } from '../WorkspaceTabPill';
import type { RunPane, RunTab } from '@/store/run-pane';
// Real module — asserting the pill's click handler requested focus is the point.
import { claimTerminalFocus } from '@/features/terminal/terminal-focus';

// v2 `Hint` needs the v2 TooltipProvider — the v1 provider satisfies nothing.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const preview: RunTab = { id: 'tab-a', kind: 'code', title: 'a.ts', path: 'a.ts', mode: 'preview' };
const permanent: RunTab = { id: 'tab-b', kind: 'code', title: 'b.ts', path: 'b.ts', mode: 'permanent' };
const terminal: RunTab = { id: 'tab-term', kind: 'terminal', title: 'Terminal' };

function seed(tabs: RunTab[], active = tabs[0]!.id): RunPane {
  const pane: RunPane = { id: 'pane-1', tabs, active };
  useLayoutStore.setState({
    layout: { top: ['chat', 'workspace'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: { dir: 'v', flex: [1, 1], panes: [pane] },
    sessions: new Map(),
    activeSessionId: null,
  });
  return pane;
}

const pill = (pane: RunPane, tab: RunTab) => (
  <WorkspaceTabPill pane={pane} tab={tab} configs={[]} scopeStatuses={{}} onStop={vi.fn()} />
);

beforeEach(() => {});

describe('WorkspaceTabPill — preview vs permanent', () => {
  it('italicises a preview tab title', () => {
    const pane = seed([preview]);
    render(pill(pane, preview));
    expect(screen.getByText('a.ts').className).toContain('italic');
  });

  it('does not italicise a permanent tab title', () => {
    const pane = seed([permanent]);
    render(pill(pane, permanent));
    expect(screen.getByText('b.ts').className).not.toContain('italic');
  });

  it('double-clicking promotes the preview tab to permanent', () => {
    const pane = seed([preview]);
    render(pill(pane, preview));

    fireEvent.doubleClick(screen.getByTestId('workspace-tab-tab-a'));
    expect(useLayoutStore.getState().run!.panes[0]!.tabs[0]!.mode).toBe('permanent');
  });
});

describe('WorkspaceTabPill — activation and close', () => {
  it('clicking the pill activates that tab', () => {
    const pane = seed([permanent, preview], 'tab-b');
    render(pill(pane, preview));

    fireEvent.click(screen.getByTestId('workspace-tab-tab-a'));
    expect(useLayoutStore.getState().run!.panes[0]!.active).toBe('tab-a');
  });

  it('the close button removes the tab without activating it', () => {
    const pane = seed([permanent, preview], 'tab-b');
    render(pill(pane, preview));

    fireEvent.click(screen.getByTestId('workspace-tab-close-tab-a'));
    const run = useLayoutStore.getState().run!;
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['tab-b']);
    expect(run.panes[0]!.active).toBe('tab-b');
  });
});

describe('WorkspaceTabPill — terminal focus request', () => {
  it('clicking a terminal tab requests focus for that tab', () => {
    const pane = seed([terminal], 'tab-b');
    render(pill(pane, terminal));

    fireEvent.click(screen.getByTestId('workspace-tab-tab-term'));
    expect(claimTerminalFocus('tab-term')).toBe(true);
  });

  it('clicking a non-terminal tab does not request terminal focus', () => {
    const pane = seed([permanent, preview], 'tab-b');
    render(pill(pane, preview));

    fireEvent.click(screen.getByTestId('workspace-tab-tab-a'));
    expect(claimTerminalFocus('tab-a')).toBe(false);
  });
});
