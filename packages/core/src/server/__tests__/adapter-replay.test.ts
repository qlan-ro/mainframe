import { describe, it, expect } from 'vitest';
import { buildConnectReplayEvents } from '../adapter-replay.js';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

const base = { name: 'C', description: 'x', installed: true, capabilities: { planMode: true } };

describe('buildConnectReplayEvents', () => {
  it('replays only probed catalogs, carrying the revision', () => {
    const snaps: AdapterInfo[] = [
      { id: 'claude', models: [{ id: 'a', label: 'A' }], modelsRevision: 3, catalogSource: 'probed', ...base },
      { id: 'codex', models: [{ id: 'b', label: 'B' }], modelsRevision: 1, catalogSource: 'fallback', ...base },
    ];
    expect(buildConnectReplayEvents(snaps)).toEqual([
      { type: 'adapter.models.updated', adapterId: 'claude', models: [{ id: 'a', label: 'A' }], modelsRevision: 3 },
    ]);
  });

  it('omits adapters with no revision', () => {
    const snaps: AdapterInfo[] = [{ id: 'x', models: [], catalogSource: 'probed', ...base }];
    expect(buildConnectReplayEvents(snaps)).toEqual([]);
  });
});
