/**
 * WorkspaceStripChrome — the strip ends shared by the tab strip and the
 * empty-state header: the grip belongs to the primary pane only, and closing
 * is refused at the dynamic floor.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { useSurfaceDragStore } from '../use-surface-drag';
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
  useSurfaceDragStore.getState().cancel();
});

describe('WorkspaceStripLead', () => {
  it('renders the surface drag grip on the primary pane', () => {
    render(<WorkspaceStripLead primary />);
    expect(screen.getByTestId('workspace-surface-drag')).toBeInTheDocument();
  });

  it('omits the grip on a secondary pane — the gesture moves the surface, not the pane', () => {
    render(<WorkspaceStripLead primary={false} />);
    expect(screen.queryByTestId('workspace-surface-drag')).not.toBeInTheDocument();
  });

  it('the grip starts a surface drag on pointer-down', () => {
    render(<WorkspaceStripLead primary />);
    fireEvent.pointerDown(screen.getByTestId('workspace-surface-drag'), { clientX: 12, clientY: 8 });

    const drag = useSurfaceDragStore.getState();
    expect(drag.kind).toBe('surface');
    expect(drag.surface).toBe('workspace');
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
