import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdapterModel } from '@qlan-ro/mainframe-types';

vi.mock('../probe-models.js', () => ({
  probeModels: vi.fn(),
}));

import { probeModels as doProbeModels } from '../probe-models.js';
import { ClaudeAdapter } from '../adapter.js';

const mockedProbe = vi.mocked(doProbeModels);

describe('ClaudeAdapter.probeModels — contextWindow enrichment', () => {
  beforeEach(() => {
    mockedProbe.mockReset();
  });

  it('preserves contextWindow from the static catalog for known model IDs', async () => {
    mockedProbe.mockResolvedValueOnce({
      models: [
        { id: 'default', label: 'Default', isDefault: true, description: 'Opus 4.7 with 1M context · Most capable' },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
        { id: 'sonnet[1m]', label: 'Sonnet 4.6 (1M context)' },
      ] satisfies AdapterModel[],
    });

    const adapter = new ClaudeAdapter();
    const probed = await adapter.probeModels();

    expect(probed).not.toBeNull();
    const byId = new Map(probed!.map((m) => [m.id, m]));
    expect(byId.get('default')?.contextWindow).toBe(1_000_000);
    expect(byId.get('claude-sonnet-4-6')?.contextWindow).toBe(200_000);
    expect(byId.get('sonnet[1m]')?.contextWindow).toBe(1_000_000);
  });

  it('listModels() returns enriched dynamic models after probe', async () => {
    mockedProbe.mockResolvedValueOnce({
      models: [{ id: 'default', label: 'Default', isDefault: true }] satisfies AdapterModel[],
    });

    const adapter = new ClaudeAdapter();
    await adapter.probeModels();
    const listed = await adapter.listModels();
    expect(listed[0]?.contextWindow).toBe(1_000_000);
  });
});
