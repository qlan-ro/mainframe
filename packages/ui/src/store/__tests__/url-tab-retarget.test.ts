import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from '../layout';

beforeEach(() => {
  useLayoutStore.setState({
    layout: { top: ['workspace'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'pane-1',
          active: 'url-a',
          tabs: [
            { id: 'url-a', kind: 'url', title: 'localhost', url: 'http://localhost:3000', scopeKey: 'p:/a' },
            { id: 'url-b', kind: 'url', title: 'example', url: 'https://example.com', scopeKey: 'p:/a' },
            { id: 'term-c', kind: 'terminal', title: 'sh', scopeKey: 'p:/a' },
          ],
        },
      ],
    },
    sessions: new Map(),
    activeSessionId: null,
  });
});

describe('useLayoutStore.setUrlTabTarget', () => {
  it('updates the tab in place when the target URL has no sibling holder', () => {
    useLayoutStore.getState().setUrlTabTarget('url-a', 'http://localhost:4000', 'localhost:4000');
    const run = useLayoutStore.getState().run!;
    const tab = run.panes[0]!.tabs.find((t) => t.id === 'url-a')!;
    expect(tab).toMatchObject({ id: 'url-a', url: 'http://localhost:4000', title: 'localhost:4000' });
  });

  it('activates a same-scope sibling already holding the target URL and leaves the source untouched', () => {
    useLayoutStore.getState().setUrlTabTarget('url-a', 'https://example.com', 'example');
    const run = useLayoutStore.getState().run!;
    expect(run.panes[0]!.active).toBe('url-b');
    const source = run.panes[0]!.tabs.find((t) => t.id === 'url-a')!;
    expect(source.url).toBe('http://localhost:3000');
  });

  it('is a no-op when the target tab id is not a url tab', () => {
    const before = useLayoutStore.getState().run;
    useLayoutStore.getState().setUrlTabTarget('term-c', 'https://example.com', 'example');
    expect(useLayoutStore.getState().run).toBe(before);
  });
});
