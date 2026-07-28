/**
 * RED-phase tests for the tuning-warning dialog copy (todo #288).
 *
 * `formatApproxTokens` renders a rough, non-committal token count for the dialog body.
 * `describeTuningChange` composes the title/body/confirm-label triple the dialog
 * renders, hedging the billing claim (the brief: describe the mechanism, never a
 * dollar figure or a cache-hit guarantee).
 *
 * The module (`../tuning-warning-copy`) does not exist yet, so this file must fail to
 * resolve; see Task 4 in the plan for the implementation that turns it green.
 */
import { describe, it, expect } from 'vitest';
import type { TuningChange } from '../tuning-warning';
import { describeTuningChange, formatApproxTokens } from '../tuning-warning-copy';

describe('formatApproxTokens', () => {
  it.each([
    { totalTokens: 48_000, expected: '~48k' },
    { totalTokens: 1_500, expected: '~2k' },
    { totalTokens: 640, expected: '~640' },
    { totalTokens: 0, expected: null },
    { totalTokens: null, expected: null },
  ])('formats $totalTokens as $expected', ({ totalTokens, expected }) => {
    expect(formatApproxTokens(totalTokens)).toBe(expected);
  });
});

describe('describeTuningChange', () => {
  const MODEL_CHANGE: TuningChange = {
    kind: 'model',
    from: 'sonnet',
    to: 'opus',
    fromLabel: 'Sonnet 4.5',
    toLabel: 'Opus 5',
  };
  const EFFORT_CHANGE: TuningChange = {
    kind: 'effort',
    from: 'high',
    to: 'max',
    fromLabel: 'High',
    toLabel: 'Maximum',
  };
  const FEATURE_ON: TuningChange = {
    kind: 'feature',
    key: 'ultracode',
    from: false,
    to: true,
    featureLabel: 'Ultracode',
  };
  const FEATURE_OFF: TuningChange = {
    kind: 'feature',
    key: 'ultracode',
    from: true,
    to: false,
    featureLabel: 'Ultracode',
  };

  it('describes a model change with the known context size', () => {
    const result = describeTuningChange(MODEL_CHANGE, 48_000);

    expect(result.title).toBe('Change model for this session?');
    expect(result.body).toBe(
      "Sonnet 4.5 → Opus 5. The session's cached context is discarded, so your next message re-sends the conversation (~48k tokens) as new input.",
    );
    expect(result.confirmLabel).toBe('Change model');
  });

  it('drops the parenthetical cleanly when the context size is unknown', () => {
    const result = describeTuningChange(MODEL_CHANGE, null);

    expect(result.body).toBe(
      "Sonnet 4.5 → Opus 5. The session's cached context is discarded, so your next message re-sends the conversation as new input.",
    );
    expect(result.body).not.toContain('(');
    expect(result.body.toLowerCase()).not.toContain('unknown');
  });

  it('describes an effort change', () => {
    const result = describeTuningChange(EFFORT_CHANGE, null);

    expect(result.title).toBe('Change effort for this session?');
    expect(result.body.startsWith('High → Maximum.')).toBe(true);
    expect(result.confirmLabel).toBe('Change effort');
  });

  it('describes a feature turning on', () => {
    const result = describeTuningChange(FEATURE_ON, null);

    expect(result.title).toBe('Change Ultracode for this session?');
    expect(result.body.startsWith('Off → On.')).toBe(true);
    expect(result.confirmLabel).toBe('Change Ultracode');
  });

  it('describes a feature turning off', () => {
    const result = describeTuningChange(FEATURE_OFF, null);

    expect(result.body.startsWith('On → Off.')).toBe(true);
  });

  it.each([
    { label: 'model', change: MODEL_CHANGE, tokens: 48_000 },
    { label: 'effort', change: EFFORT_CHANGE, tokens: null },
    { label: 'feature on', change: FEATURE_ON, tokens: null },
    { label: 'feature off', change: FEATURE_OFF, tokens: null },
  ])('never claims a dollar cost or a cache-hit guarantee ($label)', ({ change, tokens }) => {
    const { body } = describeTuningChange(change, tokens);

    expect(body).not.toContain('$');
    expect(body.toLowerCase()).not.toContain('cost');
    expect(body.toLowerCase()).not.toContain('bill');
    expect(body.toLowerCase()).not.toContain('cache hit');
    expect(body.toLowerCase()).not.toContain('cache-hit');
  });
});
