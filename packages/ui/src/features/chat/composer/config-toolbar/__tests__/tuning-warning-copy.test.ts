/**
 * Tests for the tuning-warning dialog copy (todo #288).
 *
 * `formatApproxTokens` renders a rough, non-committal token count for the dialog body.
 * `describeTuningChange` composes the title/body/confirm-label triple the dialog
 * renders. It must name the usage or cost the re-sent tokens land on, while staying
 * hedged: never a dollar figure, never a cache-hit guarantee.
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
  const MODEL_CHANGE: TuningChange = { kind: 'model', from: 'sonnet', to: 'opus' };
  const EFFORT_CHANGE: TuningChange = { kind: 'effort', from: 'high', to: 'max' };
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

  const BODY =
    'Changing model or reasoning effort will invalidate cached context, so your next message ' +
    're-sends the conversation as new input, contributing to your usage or cost.';
  const BODY_48K =
    'Changing model or reasoning effort will invalidate cached context, so your next message ' +
    're-sends the conversation (~48k tokens) as new input, contributing to your usage or cost.';

  it('quotes the context size when it is known', () => {
    expect(describeTuningChange(MODEL_CHANGE, 48_000).body).toBe(BODY_48K);
  });

  it('drops the parenthetical cleanly when the context size is unknown', () => {
    const result = describeTuningChange(MODEL_CHANGE, null);

    expect(result.body).toBe(BODY);
    expect(result.body).not.toContain('(');
    expect(result.body.toLowerCase()).not.toContain('unknown');
  });

  // The body is deliberately identical for every kind: the title names what is
  // changing, so the sentence never restates the before/after pair.
  it.each([
    { label: 'model', change: MODEL_CHANGE },
    { label: 'effort', change: EFFORT_CHANGE },
    { label: 'feature on', change: FEATURE_ON },
    { label: 'feature off', change: FEATURE_OFF },
  ])('uses the same body for a $label change', ({ change }) => {
    expect(describeTuningChange(change, null).body).toBe(BODY);
  });

  it.each([
    { label: 'model', change: MODEL_CHANGE, title: 'Change model for this session?', confirm: 'Change model' },
    { label: 'effort', change: EFFORT_CHANGE, title: 'Change effort for this session?', confirm: 'Change effort' },
    {
      label: 'feature',
      change: FEATURE_ON,
      title: 'Change Ultracode for this session?',
      confirm: 'Change Ultracode',
    },
  ])('names the $label in the title and the confirm button', ({ change, title, confirm }) => {
    const result = describeTuningChange(change, null);

    expect(result.title).toBe(title);
    expect(result.confirmLabel).toBe(confirm);
  });

  it.each([
    { label: 'model', change: MODEL_CHANGE, tokens: 48_000 },
    { label: 'effort', change: EFFORT_CHANGE, tokens: null },
    { label: 'feature on', change: FEATURE_ON, tokens: null },
    { label: 'feature off', change: FEATURE_OFF, tokens: null },
  ])('names the usage or cost without claiming a price or a cache-hit guarantee ($label)', ({ change, tokens }) => {
    const { body } = describeTuningChange(change, tokens);

    expect(body).toContain('contributing to your usage or cost');
    expect(body).not.toContain('$');
    expect(body.toLowerCase()).not.toContain('bill');
    expect(body.toLowerCase()).not.toContain('cache hit');
    expect(body.toLowerCase()).not.toContain('cache-hit');
  });
});
