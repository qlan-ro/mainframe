import { describe, it, expect, vi, beforeEach } from 'vitest';

const killSpy = vi.fn();
vi.mock('../terminal-cleanup', () => ({ killAndDisposeCachedTerminals: (ids: string[]) => killSpy(ids) }));

import { useActiveBasesStore } from '../active-bases-store';
import { useLayoutStore } from '../layout';

beforeEach(() => {
  killSpy.mockReset();
  useLayoutStore.setState({
    layout: { top: ['workspace'], topFlex: {} },
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
    expect(useLayoutStore.getState().layout.top).not.toContain('workspace');
  });
});

describe('what is left on screen', () => {
  const tabs = (...scopes: (string | null)[]) =>
    scopes.map((scopeKey, i) => ({
      id: `t${i}`,
      kind: 'terminal' as const,
      title: 'sh',
      ...(scopeKey ? { scopeKey } : {}),
    }));
  const seed = (scopeKey: string, list: ReturnType<typeof tabs>) => {
    useActiveBasesStore.setState({ bases: {}, scopeKey });
    useLayoutStore.setState({
      layout: { top: ['chat', 'workspace'], topFlex: {} },
      run: { dir: 'v', flex: [1, 1], panes: [{ id: 'p', tabs: list, active: list[0]!.id }] },
    });
  };
  const lit = () => useLayoutStore.getState().layout.top.includes('workspace');

  it('collapses the workspace with its last visible tab, whatever another scope keeps', () => {
    seed('p:/a', tabs('p:/a', 'p:/b'));
    useLayoutStore.getState().releaseRunScope('p:/a');
    expect(lit()).toBe(false);
    expect(useLayoutStore.getState().run!.panes[0]!.tabs).toHaveLength(1);
  });

  it('keeps it open for the tabs of the scope on screen', () => {
    seed('p:/a', tabs('p:/a', 'p:/b'));
    useLayoutStore.getState().releaseRunScope('p:/b');
    expect(lit()).toBe(true);
  });

  it('keeps it open for a chat tab', () => {
    seed('p:/a', tabs('p:/a'));
    useLayoutStore.getState().addRunTab({ id: 'chat-f', kind: 'chat', title: 'Fork', chatId: 'f', role: 'fork' });
    useLayoutStore.getState().releaseRunScope('p:/a');
    expect(lit()).toBe(true);
  });
});
