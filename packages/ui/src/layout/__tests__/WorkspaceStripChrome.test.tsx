/**
 * WorkspaceStripChrome — the strip ends shared by the tab strip and the
 * empty-state header: closing is refused at the dynamic floor. (The surface
 * drag grip is gone — the whole surface-drag system was retired 2026-08-12.)
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { WorkspaceStripActions, WorkspaceStripLead } from '../WorkspaceStripChrome';

// v2 `Hint` needs the v2 TooltipProvider — the v1 provider satisfies nothing.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

function seedLayout(top: ('chat' | 'workspace')[], bottom: 'chat' | 'workspace' | null = null) {
  useLayoutStore.setState({
    layout: { top, bottom, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
}

beforeEach(() => {
  seedLayout(['chat', 'workspace']);
});

describe('WorkspaceStripLead', () => {
  it('carries no drag grip — the surface-drag system is retired', () => {
    render(<WorkspaceStripLead primary />);
    expect(screen.queryByTestId('workspace-surface-drag')).not.toBeInTheDocument();
  });
});

describe('WorkspaceStripActions', () => {
  it('carries no split actions — the strip only renders while the workspace is placed', () => {
    render(<WorkspaceStripActions paneId="pane-1" primary />);
    expect(screen.queryByTestId('workspace-tab-strip-split-right')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-tab-strip-split-down')).not.toBeInTheDocument();
  });

  it('close hides the workspace', () => {
    render(<WorkspaceStripActions paneId="pane-1" primary />);
    fireEvent.click(screen.getByTestId('workspace-surface-close'));
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
  });

  it('close is disabled when the workspace is the last lit surface', () => {
    seedLayout(['workspace']);
    render(<WorkspaceStripActions paneId="pane-1" primary />);
    expect(screen.getByTestId('workspace-surface-close')).toBeDisabled();
  });

  it('a secondary pane offers un-split instead of the surface close', () => {
    render(<WorkspaceStripActions paneId="pane-2" primary={false} />);
    expect(screen.queryByTestId('workspace-surface-close')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-pane-close-pane-2')).toBeInTheDocument();
  });

  it('un-split closes that pane', () => {
    useLayoutStore.setState({
      run: {
        dir: 'v',
        flex: [1, 1],
        panes: [
          { id: 'pane-1', tabs: [{ id: 'a', kind: 'code', title: 'a.ts', path: 'a.ts' }], active: 'a' },
          { id: 'pane-2', tabs: [{ id: 'b', kind: 'code', title: 'b.ts', path: 'b.ts' }], active: 'b' },
        ],
      },
    });
    render(<WorkspaceStripActions paneId="pane-2" primary={false} />);

    fireEvent.click(screen.getByTestId('workspace-pane-close-pane-2'));
    expect(useLayoutStore.getState().run!.panes.map((p) => p.id)).toEqual(['pane-1']);
  });
});
