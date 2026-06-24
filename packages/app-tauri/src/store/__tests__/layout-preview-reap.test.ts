import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting, getHost } from '@/lib/host';

import { useLayoutStore } from '../layout';

function seedPreviewRun() {
  useLayoutStore.setState({
    layout: { top: ['chat', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'p1',
          tabs: [
            { id: 'prev-1', kind: 'preview', title: 'dev', config: 'dev' },
            { id: 'term-1', kind: 'terminal', title: 'sh' },
          ],
          active: 'prev-1',
        },
      ],
    },
    sessions: new Map(),
    activeSessionId: null,
  });
}

let fakeHost: FakeHostBridge;

beforeEach(() => {
  fakeHost = new FakeHostBridge();
  fakeHost.preview.destroy = vi.fn().mockResolvedValue(undefined);
  setHostForTesting(fakeHost);
  seedPreviewRun();
});

afterEach(() => {
  resetHostForTesting();
});

it('closeRunTab destroys the child webview for a preview tab', () => {
  useLayoutStore.getState().closeRunTab('p1', 'prev-1');
  expect(getHost().preview.destroy).toHaveBeenCalledWith('prev-1');
});

it('closeRunTab does NOT call preview.destroy for a non-preview tab', () => {
  useLayoutStore.getState().closeRunTab('p1', 'term-1');
  expect(getHost().preview.destroy).not.toHaveBeenCalled();
});

it('closePane destroys every preview tab in the pane', () => {
  useLayoutStore.setState({
    run: {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'p1',
          tabs: [
            { id: 'prev-2', kind: 'preview', title: 'dev', config: 'dev' },
            { id: 'prev-3', kind: 'preview', title: 'api', config: 'api' },
          ],
          active: 'prev-2',
        },
      ],
    },
  });
  useLayoutStore.getState().closePane('p1');
  expect(getHost().preview.destroy).toHaveBeenCalledWith('prev-2');
  expect(getHost().preview.destroy).toHaveBeenCalledWith('prev-3');
});
