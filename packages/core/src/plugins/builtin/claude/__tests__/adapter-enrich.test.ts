import { describe, it, expect } from 'vitest';
import { enrichWithContextWindow } from '../adapter.js';
import type { AdapterModel } from '@qlan-ro/mainframe-types';

describe('enrichWithContextWindow', () => {
  it('infers 1M window from a [1m] id suffix when the description omits "1M"', () => {
    const probed: AdapterModel[] = [{ id: 'claude-fable-5[1m]', label: 'Fable 5', description: 'Fable 5' }];
    expect(enrichWithContextWindow(probed)[0]!.contextWindow).toBe(1_000_000);
  });
  it('keeps the 200k default for a non-[1m] unknown id with no 1M description', () => {
    const probed: AdapterModel[] = [{ id: 'claude-fable-5', label: 'Fable 5', description: 'Fable 5' }];
    expect(enrichWithContextWindow(probed)[0]!.contextWindow).toBe(200_000);
  });
  it('stamps the default entry window from resolvedModel when it resolves to a [1m] model', () => {
    const probed: AdapterModel[] = [{ id: 'default', label: 'Default', description: 'Fable 5' }];
    expect(enrichWithContextWindow(probed, 'claude-fable-5[1m]')[0]!.contextWindow).toBe(1_000_000);
  });
});
