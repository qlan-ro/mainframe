/**
 * RED-phase tests for the pure tuning-warning decision module (todo #288).
 *
 * `resolveTuningChange` turns a raw control request into a described before/after
 * change (or null when there's no chat to change); `shouldWarnTuningChange` decides
 * whether that change should surface the confirm dialog. Neither function touches
 * React, the daemon, or persisted state — every case here is a plain object in, a
 * plain value out.
 *
 * The module (`../tuning-warning`) does not exist yet, so this file must fail to
 * resolve; see Task 2 in the plan for the implementation that turns it green.
 */
import { describe, it, expect } from 'vitest';
import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';
import type { TuningChange, TuningWarningContext } from '../tuning-warning';
import { resolveTuningChange, shouldWarnTuningChange } from '../tuning-warning';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADAPTER: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: 'Claude Code',
  installed: true,
  capabilities: { planMode: true },
  models: [
    { id: 'sonnet', label: 'Sonnet 4.5', supportedEfforts: ['high', 'max'], supportsUltracode: true },
    { id: 'opus', label: 'Opus 5', supportedEfforts: ['high', 'max'], supportsUltracode: true },
  ],
};

const SONNET = ADAPTER.models[0]!;

function makeChat(overrides?: Partial<Chat>): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    effort: 'high',
    ultracode: false,
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<TuningWarningContext>): TuningWarningContext {
  return {
    chat: makeChat(),
    adapter: ADAPTER,
    model: SONNET,
    providerDefaults: undefined,
    hasMessages: true,
    contextTokens: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveTuningChange
// ---------------------------------------------------------------------------

describe('resolveTuningChange', () => {
  it('resolves a model change from the currently selected model to another catalog model', () => {
    const ctx = makeCtx({ model: SONNET });

    const change = resolveTuningChange(ctx, { kind: 'model', to: 'opus' });

    expect(change).toEqual({
      kind: 'model',
      from: 'sonnet',
      to: 'opus',
      fromLabel: 'Sonnet 4.5',
      toLabel: 'Opus 5',
    });
  });

  it('falls back to the raw id for toLabel when the target model is not in the catalog', () => {
    const ctx = makeCtx({ model: SONNET });

    const change = resolveTuningChange(ctx, { kind: 'model', to: 'not-in-catalog' });

    expect(change).toMatchObject({ kind: 'model', to: 'not-in-catalog', toLabel: 'not-in-catalog' });
  });

  it("resolves from:null and fromLabel:'Current model' when neither chat.model nor the resolved model is known", () => {
    const ctx = makeCtx({ model: null, chat: makeChat({ model: undefined }) });

    const change = resolveTuningChange(ctx, { kind: 'model', to: 'opus' });

    expect(change).toMatchObject({ kind: 'model', from: null, fromLabel: 'Current model' });
  });

  it("resolves an effort change using the effective (displayed) effort as 'from'", () => {
    const ctx = makeCtx({ chat: makeChat({ effort: 'high' }), model: SONNET });

    const change = resolveTuningChange(ctx, { kind: 'effort', to: 'max' });

    expect(change).toMatchObject({ kind: 'effort', from: 'high', fromLabel: 'High', toLabel: 'Maximum' });
  });

  it('resolves an inherited effort from providerDefaults.defaultEffort when the chat has no override', () => {
    const ctx = makeCtx({
      chat: makeChat({ effort: null }),
      model: SONNET,
      providerDefaults: { defaultEffort: 'low' },
    });

    const change = resolveTuningChange(ctx, { kind: 'effort', to: 'max' });

    expect(change).toMatchObject({ kind: 'effort', from: 'low' });
  });

  it('resolves a boolean feature change with the labeled feature name', () => {
    const ctx = makeCtx({ chat: makeChat({ ultracode: false }) });

    const change = resolveTuningChange(ctx, { kind: 'feature', key: 'ultracode', to: true });

    expect(change).toEqual({ kind: 'feature', key: 'ultracode', from: false, to: true, featureLabel: 'Ultracode' });
  });

  it('returns null when there is no chat to change', () => {
    const ctx = makeCtx({ chat: null });

    expect(resolveTuningChange(ctx, { kind: 'model', to: 'opus' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// shouldWarnTuningChange
// ---------------------------------------------------------------------------

const MODEL_CHANGE: TuningChange = {
  kind: 'model',
  from: 'sonnet',
  to: 'opus',
  fromLabel: 'Sonnet 4.5',
  toLabel: 'Opus 5',
};
const EFFORT_CHANGE: TuningChange = { kind: 'effort', from: 'high', to: 'max', fromLabel: 'High', toLabel: 'Maximum' };
const FEATURE_CHANGE: TuningChange = {
  kind: 'feature',
  key: 'ultracode',
  from: false,
  to: true,
  featureLabel: 'Ultracode',
};

const NOOP_MODEL_CHANGE: TuningChange = {
  kind: 'model',
  from: 'sonnet',
  to: 'sonnet',
  fromLabel: 'Sonnet 4.5',
  toLabel: 'Sonnet 4.5',
};
const NOOP_EFFORT_CHANGE: TuningChange = {
  kind: 'effort',
  from: 'high',
  to: 'high',
  fromLabel: 'High',
  toLabel: 'High',
};
const NOOP_FEATURE_CHANGE: TuningChange = {
  kind: 'feature',
  key: 'ultracode',
  from: false,
  to: false,
  featureLabel: 'Ultracode',
};

const NULL_FROM_MODEL_CHANGE: TuningChange = {
  kind: 'model',
  from: null,
  to: 'opus',
  fromLabel: 'Current model',
  toLabel: 'Opus 5',
};

describe('shouldWarnTuningChange', () => {
  it.each([
    { label: 'model', change: MODEL_CHANGE },
    { label: 'effort', change: EFFORT_CHANGE },
    { label: 'feature', change: FEATURE_CHANGE },
  ])('never warns when the chat has no messages ($label)', ({ change }) => {
    expect(shouldWarnTuningChange({ change, hasMessages: false, suppressed: false })).toBe(false);
  });

  it.each([
    { label: 'model', change: MODEL_CHANGE },
    { label: 'effort', change: EFFORT_CHANGE },
    { label: 'feature', change: FEATURE_CHANGE },
  ])('never warns once the user has suppressed the warning ($label)', ({ change }) => {
    expect(shouldWarnTuningChange({ change, hasMessages: true, suppressed: true })).toBe(false);
  });

  it.each([
    { label: 'model', change: MODEL_CHANGE },
    { label: 'effort', change: EFFORT_CHANGE },
    { label: 'feature', change: FEATURE_CHANGE },
  ])('warns when the chat has messages, is not suppressed, and from !== to ($label)', ({ change }) => {
    expect(shouldWarnTuningChange({ change, hasMessages: true, suppressed: false })).toBe(true);
  });

  it.each([
    { label: 'model', change: NOOP_MODEL_CHANGE },
    { label: 'effort', change: NOOP_EFFORT_CHANGE },
    { label: 'feature', change: NOOP_FEATURE_CHANGE },
  ])('never warns on a no-op re-pick of the current value ($label)', ({ change }) => {
    expect(shouldWarnTuningChange({ change, hasMessages: true, suppressed: false })).toBe(false);
  });

  it('warns on a model change with an unresolvable from (null), so it never silently bypasses the warning', () => {
    expect(shouldWarnTuningChange({ change: NULL_FROM_MODEL_CHANGE, hasMessages: true, suppressed: false })).toBe(true);
  });
});
