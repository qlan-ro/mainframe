import { describe, it, expect } from 'vitest';
import { releaseRunScope, terminalIdsForScope, type RunState } from '../run-pane';

const SCOPE = 'p:/a';
const OTHER = 'p:/b';

function run(): RunState {
  return {
    dir: 'v',
    flex: [0.4, 0.6],
    panes: [
      {
        id: 'pane-1',
        active: 't2',
        tabs: [
          { id: 't1', kind: 'preview', title: 'A', config: 'dev', scopeKey: SCOPE },
          { id: 't2', kind: 'terminal', title: 'sh', scopeKey: SCOPE },
          { id: 't3', kind: 'preview', title: 'B', config: 'dev', scopeKey: OTHER },
        ],
      },
      {
        id: 'pane-2',
        active: 't4',
        tabs: [{ id: 't4', kind: 'terminal', title: 'sh2', scopeKey: SCOPE }],
      },
    ],
  };
}

describe('terminalIdsForScope', () => {
  it('returns only terminal tab ids of the target scope', () => {
    expect(terminalIdsForScope(run(), SCOPE)).toEqual(['t2', 't4']);
  });
  it('returns [] for null run', () => {
    expect(terminalIdsForScope(null, SCOPE)).toEqual([]);
  });
});

describe('releaseRunScope', () => {
  it('removes only the target scope tabs, keeping other-scope tabs', () => {
    const r = releaseRunScope(run(), SCOPE)!;
    expect(r.panes.map((p) => p.id)).toEqual(['pane-1']); // pane-2 emptied → dropped
    expect(r.panes[0]!.tabs.map((t) => t.id)).toEqual(['t3']);
  });
  it('re-points active to the last surviving tab when the active was removed', () => {
    const r = releaseRunScope(run(), SCOPE)!;
    expect(r.panes[0]!.active).toBe('t3');
  });
  it('resets flex to [1,1] when collapsing to one pane', () => {
    const r = releaseRunScope(run(), SCOPE)!;
    expect(r.flex).toEqual([1, 1]);
  });
  it('returns null when every tab belonged to the released scope', () => {
    const onlyScope: RunState = {
      dir: 'v',
      flex: [1, 1],
      panes: [{ id: 'p1', active: 't1', tabs: [{ id: 't1', kind: 'terminal', title: 'x', scopeKey: SCOPE }] }],
    };
    expect(releaseRunScope(onlyScope, SCOPE)).toBeNull();
  });
});
