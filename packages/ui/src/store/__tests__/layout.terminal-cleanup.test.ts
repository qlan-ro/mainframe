import { describe, expect, it, vi, beforeEach } from 'vitest';

const killDisposeSpy = vi.fn();
vi.mock('../terminal-cleanup', () => ({
  killAndDisposeCachedTerminals: (...a: unknown[]) => killDisposeSpy(...a),
}));

import { useLayoutStore } from '../layout';

function seedRun() {
  useLayoutStore.setState({
    layout: { top: ['chat', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: {
      dir: 'v',
      flex: [1, 1],
      panes: [
        { id: 'p1', tabs: [{ id: 't1', kind: 'terminal', title: 'Terminal' }], active: 't1' },
        { id: 'p2', tabs: [{ id: 't2', kind: 'terminal', title: 'Terminal' }], active: 't2' },
      ],
    },
    sessions: new Map(),
    activeSessionId: null,
  });
}

describe('layout terminal cleanup', () => {
  beforeEach(() => {
    killDisposeSpy.mockClear();
    seedRun();
  });

  it('closeRunTab kills the closed terminal', () => {
    useLayoutStore.getState().closeRunTab('p1', 't1');
    expect(killDisposeSpy).toHaveBeenCalledWith(['t1']);
  });

  it('closePane kills every terminal in the closed pane', () => {
    useLayoutStore.getState().closePane('p2');
    expect(killDisposeSpy).toHaveBeenCalledWith(['t2']);
  });

  it('toggling Run off kills every terminal in the run state', () => {
    useLayoutStore.getState().toggleSurface('run');
    const ids = killDisposeSpy.mock.calls[0]![0] as string[];
    expect(ids.sort()).toEqual(['t1', 't2']);
  });

  it('closeRunTab on a non-terminal tab does NOT call cleanup at all', () => {
    useLayoutStore.setState({
      run: {
        dir: 'v',
        flex: [1, 1],
        panes: [{ id: 'p1', tabs: [{ id: 'c1', kind: 'code', title: 'a.ts' }], active: 'c1' }],
      },
    });
    useLayoutStore.getState().closeRunTab('p1', 'c1');
    expect(killDisposeSpy).not.toHaveBeenCalled();
  });

  // C1 guard: a session switch must NOT reap terminals (output preservation).
  it('setActiveSession does not kill any terminals', () => {
    // Park the current run as session A, switch to a fresh session B.
    useLayoutStore.setState({ activeSessionId: 'A', sessions: new Map() });
    useLayoutStore.getState().setActiveSession('B');
    expect(killDisposeSpy).not.toHaveBeenCalled();
  });
});
