import { it, expect, vi, beforeEach } from 'vitest';

const previewDestroy = vi.fn();
vi.mock('@/lib/tauri/preview', () => ({ previewDestroy: (...a: unknown[]) => previewDestroy(...a) }));

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

beforeEach(() => {
  previewDestroy.mockReset().mockResolvedValue(undefined);
  seedPreviewRun();
});

it('closeRunTab destroys the child webview for a preview tab', () => {
  useLayoutStore.getState().closeRunTab('p1', 'prev-1');
  expect(previewDestroy).toHaveBeenCalledWith('prev-1');
});

it('closeRunTab does NOT call previewDestroy for a non-preview tab', () => {
  useLayoutStore.getState().closeRunTab('p1', 'term-1');
  expect(previewDestroy).not.toHaveBeenCalled();
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
  expect(previewDestroy).toHaveBeenCalledWith('prev-2');
  expect(previewDestroy).toHaveBeenCalledWith('prev-3');
});
