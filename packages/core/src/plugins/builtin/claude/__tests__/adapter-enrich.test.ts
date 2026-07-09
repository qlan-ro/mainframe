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

  // Live-probed CLI shapes (2026-07-09): each entry carries its own resolvedModel,
  // e.g. { value: 'opus[1m]', resolvedModel: 'claude-opus-4-8[1m]' },
  // { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001' },
  // { value: 'claude-fable-5[1m]', resolvedModel: 'claude-fable-5' } (suffix on id only).
  it('infers 1M from a non-default entry whose own resolvedModel carries [1m]', () => {
    const probed: AdapterModel[] = [
      { id: 'opus[1m]', label: 'Opus', description: 'Opus 4.8 with 1M context', resolvedModel: 'claude-opus-4-8[1m]' },
      { id: 'my-alias', label: 'Aliased', description: 'Some model', resolvedModel: 'claude-something-9[1m]' },
    ];
    const enriched = enrichWithContextWindow(probed);
    expect(enriched[0]!.contextWindow).toBe(1_000_000);
    expect(enriched[1]!.contextWindow).toBe(1_000_000);
  });

  it('keeps the [1m] id suffix authoritative even when resolvedModel drops it', () => {
    const probed: AdapterModel[] = [
      { id: 'claude-fable-5[1m]', label: 'Fable 5', description: 'Fable 5', resolvedModel: 'claude-fable-5' },
    ];
    expect(enrichWithContextWindow(probed)[0]!.contextWindow).toBe(1_000_000);
  });

  it('resolves the static-catalog window via the entry resolvedModel for alias ids', () => {
    const probed: AdapterModel[] = [
      { id: 'haiku', label: 'Haiku 4.5', description: 'Fastest', resolvedModel: 'claude-haiku-4-5-20251001' },
    ];
    expect(enrichWithContextWindow(probed)[0]!.contextWindow).toBe(200_000);
  });

  it('gives claude-sonnet-5 the extended window from the static catalog (live-verified 1M)', () => {
    const probed: AdapterModel[] = [
      { id: 'sonnet', label: 'Sonnet 5', description: 'Efficient for routine tasks', resolvedModel: 'claude-sonnet-5' },
    ];
    expect(enrichWithContextWindow(probed)[0]!.contextWindow).toBe(1_000_000);
  });
});
