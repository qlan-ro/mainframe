// packages/core/src/__tests__/automations/substitute.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChipText, TokenRef } from '@qlan-ro/mainframe-types';
import { renderChipText, resolveToken, type TokenContext } from '../../automations/tokens/substitute.js';
import type { AutomationCheckpointStep } from '../../automations/store/types.js';

function step(outputs: Record<string, unknown> | null): AutomationCheckpointStep {
  return { stepId: 's', kind: 'run_action', status: 'succeeded', outputs, error: null, startedAt: 0, finishedAt: 1 };
}

function emptyCtx(overrides: Partial<TokenContext> = {}): TokenContext {
  return { trigger: {}, steps: {}, currentItems: [], ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('renderChipText', () => {
  it('joins literal ChipText parts with no tokens', () => {
    expect(renderChipText(emptyCtx(), ['Hello ', 'World'])).toBe('Hello World');
  });

  it('renders an unset token as an empty string', () => {
    const text: ChipText = ['before-', { token: { stepId: 'never-ran', output: 'x' } }, '-after'];
    expect(renderChipText(emptyCtx(), text)).toBe('before--after');
  });

  it('renders a null-outputs step as an empty string', () => {
    const ctx = emptyCtx({ steps: { s1: step(null) } });
    const text: ChipText = [{ token: { stepId: 's1', output: 'x' } }];
    expect(renderChipText(ctx, text)).toBe('');
  });

  it('coerces a number output to its String() form', () => {
    const ctx = emptyCtx({ steps: { s1: step({ n: 42 }) } });
    expect(renderChipText(ctx, [{ token: { stepId: 's1', output: 'n' } }])).toBe('42');
  });

  it('coerces a list output by joining with newlines', () => {
    const ctx = emptyCtx({ steps: { s1: step({ items: ['a', 'b', 'c'] }) } });
    expect(renderChipText(ctx, [{ token: { stepId: 's1', output: 'items' } }])).toBe('a\nb\nc');
  });

  it('coerces an object output via JSON.stringify', () => {
    const ctx = emptyCtx({ steps: { s1: step({ record: { x: 1 } }) } });
    expect(renderChipText(ctx, [{ token: { stepId: 's1', output: 'record' } }])).toBe('{"x":1}');
  });

  it('digs into a structured trigger payload via a dot-path field', () => {
    const ctx = emptyCtx({ trigger: { payload: { pull_request: { html_url: 'https://x/1' } } } });
    const text: ChipText = [{ token: { stepId: 'trigger', output: 'payload', field: 'pull_request.html_url' } }];
    expect(renderChipText(ctx, text)).toBe('https://x/1');
  });

  it('resolves builtin.today as a local YYYY-MM-DD date', () => {
    const reference = new Date(2026, 6, 12, 23, 30); // local time, deliberately near midnight
    vi.useFakeTimers();
    vi.setSystemTime(reference);
    const expected = `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, '0')}-${String(reference.getDate()).padStart(2, '0')}`;
    expect(renderChipText(emptyCtx(), [{ token: { stepId: 'builtin', output: 'today' } }])).toBe(expected);
  });

  it('resolves builtin.now as an ISO timestamp', () => {
    const reference = new Date('2026-07-12T18:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(reference);
    expect(renderChipText(emptyCtx(), [{ token: { stepId: 'builtin', output: 'now' } }])).toBe(reference.toISOString());
  });

  it('resolves `current` to the innermost item of the iteration stack', () => {
    const ctx = emptyCtx({ currentItems: [{ url: 'outer' }, { url: 'inner' }] });
    const text: ChipText = [{ token: { stepId: 'current', output: 'item', field: 'url' } }];
    expect(renderChipText(ctx, text)).toBe('inner');
  });
});

describe('resolveToken', () => {
  it('returns the raw typed value, unlike renderChipText which stringifies', () => {
    const ctx = emptyCtx({ steps: { s1: step({ items: ['a', 'b'] }) } });
    const ref: TokenRef = { stepId: 's1', output: 'items' };
    expect(resolveToken(ctx, ref)).toEqual(['a', 'b']);
    expect(renderChipText(ctx, [{ token: ref }])).toBe('a\nb');
  });

  it('returns undefined for an unset token rather than coercing to a string', () => {
    const ref: TokenRef = { stepId: 'never-ran', output: 'x' };
    expect(resolveToken(emptyCtx(), ref)).toBeUndefined();
  });
});
