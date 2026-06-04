import { describe, it, expect } from 'vitest';
import { effortOptions, visibleFeatures, displayEffort } from '../../renderer/lib/model-tuning.js';

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
    const model = { id: 'm', label: 'M', supportedEfforts: ['low', 'xhigh'] as const, supportsUltracode: true };
    expect(displayEffort({ effort: 'low', ultracode: true }, model)).toEqual({ value: 'xhigh', locked: true });
    expect(displayEffort({ effort: 'low' }, model)).toEqual({ value: 'low', locked: false });
  });

  it('does NOT lock to xhigh when the model lacks ultracode support (mirrors resolver clamp)', () => {
    const noUltra = { id: 'm', label: 'M', supportedEfforts: ['low', 'high'] as const }; // no supportsUltracode
    expect(displayEffort({ effort: 'low', ultracode: true }, noUltra)).toEqual({ value: 'low', locked: false });
  });

  it('clamps displayed effort to supportedEfforts', () => {
    const model = { id: 'm', label: 'M', supportedEfforts: ['low', 'high'] as const, defaultEffort: 'high' as const };
    // provider default 'xhigh' isn't supported → falls back to the supported default
    expect(displayEffort({}, model, { defaultEffort: 'xhigh' }).value).toBe('high');
  });
});
