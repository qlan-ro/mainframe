import { describe, it, expect, vi, beforeEach } from 'vitest';

const killSpy = vi.fn();
vi.mock('../terminal-cleanup', () => ({ killAndDisposeCachedTerminals: (ids: string[]) => killSpy(ids) }));

import { useLayoutStore } from '../layout';

beforeEach(() => {
  killSpy.mockReset();
  useLayoutStore.setState({
    layout: { top: ['run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'pane-1',
          active: 'term-a',
          tabs: [
            { id: 'term-a', kind: 'terminal', title: 'sh', scopeKey: 'p:/a' },
            { id: 'prev-b', kind: 'preview', title: 'B', config: 'dev', scopeKey: 'p:/b' },
          ],
        },
      ],
    },
    sessions: new Map(),
    activeSessionId: null,
  });
});

describe('useLayoutStore.releaseRunScope', () => {
  it('disposes the scope terminals and removes the scope tabs', () => {
    useLayoutStore.getState().releaseRunScope('p:/a');
    expect(killSpy).toHaveBeenCalledWith(['term-a']);
    const run = useLayoutStore.getState().run!;
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['prev-b']);
  });

  it('clears the Run surface when the released scope was the only content', () => {
    useLayoutStore.getState().releaseRunScope('p:/b'); // remove prev-b too
    useLayoutStore.getState().releaseRunScope('p:/a'); // now empty
    expect(useLayoutStore.getState().run).toBeNull();
    expect(useLayoutStore.getState().layout.top).not.toContain('run');
  });
});
