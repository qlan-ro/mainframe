/**
 * WorkspaceTabStrip — a second pane's own header row: its tabs, the `+` and the
 * un-split button. Hiding the workspace belongs to the title bar, not to a pane.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLayoutStore } from '@/store/layout';
import type { RunPane } from '@/store/run-pane';

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: 'chat-1' }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({ configs: [], scopeStatuses: {}, handleLaunch: vi.fn(), handleStop: vi.fn() }),
}));

import { WorkspaceTabStrip } from '../WorkspaceTabStrip';

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const FIRST: RunPane = { id: 'pane-1', tabs: [{ id: 'a', kind: 'code', title: 'a.ts', path: 'a.ts' }], active: 'a' };
const SECOND: RunPane = { id: 'pane-2', tabs: [{ id: 'b', kind: 'code', title: 'b.ts', path: 'b.ts' }], active: 'b' };

beforeEach(() => {
  useLayoutStore.setState({
    layout: { top: ['chat', 'workspace'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: { dir: 'v', flex: [1, 1], panes: [FIRST, SECOND] },
    sessions: new Map(),
    activeSessionId: null,
  });
});

describe('WorkspaceTabStrip', () => {
  it("shows the pane's tabs and its own +", () => {
    render(<WorkspaceTabStrip pane={SECOND} />);
    expect(screen.getByRole('tab')).toHaveTextContent('b.ts');
    expect(screen.getByTestId('workspace-tab-strip-add-pane-2')).toBeInTheDocument();
  });

  it('offers un-split and no surface close or split', () => {
    render(<WorkspaceTabStrip pane={SECOND} />);
    expect(screen.getByRole('button', { name: 'Close pane' })).toBe(screen.getByTestId('workspace-pane-close-pane-2'));
    expect(screen.queryByTestId('workspace-surface-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-tab-strip-split-right')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-tab-strip-split-down')).not.toBeInTheDocument();
  });

  it('un-split closes that pane and leaves the workspace open', () => {
    render(<WorkspaceTabStrip pane={SECOND} />);
    fireEvent.click(screen.getByTestId('workspace-pane-close-pane-2'));
    expect(useLayoutStore.getState().run!.panes.map((p) => p.id)).toEqual(['pane-1']);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat', 'workspace']);
  });
});
