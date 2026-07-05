import { describe, it, expect } from 'vitest';
import type { AdapterModel } from '@qlan-ro/mainframe-types';
import { effortOptions, visibleFeatures, displayEffort } from '../model-tuning.js';

describe('model-tuning helpers', () => {
  it('effortOptions maps supportedEfforts to labelled options', () => {
    const opts = effortOptions({ id: 'm', label: 'M', supportedEfforts: ['low', 'xhigh', 'max'] });
    expect(opts.map((o) => o.id)).toEqual(['low', 'xhigh', 'max']);
    expect(opts.find((o) => o.id === 'xhigh')!.label).toBe('Extra-high');
  });
  it('visibleFeatures gates by capability', () => {
    expect(visibleFeatures({ id: 'm', label: 'M', supportsFast: true }).map((f) => f.key)).toEqual(['fast']);
  });
  it('displayEffort locks to xhigh under ultracode without changing stored effort', () => {
    const model = {
      id: 'm',
      label: 'M',
      supportedEfforts: ['low', 'xhigh'],
      supportsUltracode: true,
    } satisfies AdapterModel;
    expect(displayEffort({ effort: 'low', ultracode: true }, model)).toEqual({ value: 'xhigh', locked: true });
    expect(displayEffort({ effort: 'low' }, model)).toEqual({ value: 'low', locked: false });
  });

  it('does NOT lock to xhigh when the model lacks ultracode support (mirrors resolver clamp)', () => {
    const noUltra = { id: 'm', label: 'M', supportedEfforts: ['low', 'high'] } satisfies AdapterModel; // no supportsUltracode
    expect(displayEffort({ effort: 'low', ultracode: true }, noUltra)).toEqual({ value: 'low', locked: false });
  });

  it('clamps displayed effort to supportedEfforts', () => {
    const model = {
      id: 'm',
      label: 'M',
      supportedEfforts: ['low', 'high'],
      defaultEffort: 'high',
    } satisfies AdapterModel;
    // provider default 'xhigh' isn't supported → falls back to the supported default
    expect(displayEffort({}, model, { defaultEffort: 'xhigh' }).value).toBe('high');
  });

  it('mirrors the resolver: highest supported <= requested when there is no valid defaultEffort', () => {
    // Sonnet-like: supports low/medium/high/max but NOT xhigh, and no defaultEffort.
    // Inherited provider 'xhigh' must display 'high' (highest <= xhigh) — same as the
    // server resolver — NOT 'low' (the lowest supported).
    const sonnet = { id: 'm', label: 'M', supportedEfforts: ['low', 'medium', 'high', 'max'] } satisfies AdapterModel;
    expect(displayEffort({}, sonnet, { defaultEffort: 'xhigh' }).value).toBe('high');
  });
});
