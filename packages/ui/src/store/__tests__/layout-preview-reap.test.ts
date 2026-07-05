import { it, expect } from 'vitest';

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

// Preview destruction is now handled by the PreviewInstance lifecycle hook's
// cleanup effect when the component unmounts. The store's job is just to remove
// the tab from the run state (which unmounts the component).

it('closeRunTab removes the preview tab from run state', () => {
  seedPreviewRun();
  useLayoutStore.getState().closeRunTab('p1', 'prev-1');
  const run = useLayoutStore.getState().run;
  const tabs = run?.panes.find((p) => p.id === 'p1')?.tabs ?? [];
  expect(tabs.some((t) => t.id === 'prev-1')).toBe(false);
});

it('closeRunTab keeps the non-preview terminal tab', () => {
  seedPreviewRun();
  useLayoutStore.getState().closeRunTab('p1', 'prev-1');
  const run = useLayoutStore.getState().run;
  const tabs = run?.panes.find((p) => p.id === 'p1')?.tabs ?? [];
  expect(tabs.some((t) => t.id === 'term-1')).toBe(true);
});

it('closePane removes the entire pane from run state', () => {
  useLayoutStore.setState({
    layout: { top: ['chat', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
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
    sessions: new Map(),
    activeSessionId: null,
  });
  useLayoutStore.getState().closePane('p1');
  const run = useLayoutStore.getState().run;
  expect(run?.panes.some((p) => p.id === 'p1')).toBeFalsy();
});
