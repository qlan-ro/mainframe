// packages/core/src/__tests__/automations/comparators.test.ts
import { describe, it, expect } from 'vitest';
import type { Comparator, ConditionRow } from '@qlan-ro/mainframe-types';
import { evalConditions } from '../../automations/engine/comparators.js';
import type { TokenContext } from '../../automations/tokens/substitute.js';
import type { AutomationCheckpointStep } from '../../automations/store/types.js';

function step(outputs: Record<string, unknown> | null): AutomationCheckpointStep {
  return { stepId: 's1', kind: 'ask_me', status: 'succeeded', outputs, error: null, startedAt: 0, finishedAt: 1 };
}

function ctxFor(value: unknown): TokenContext {
  return { trigger: {}, steps: { s1: step(value === undefined ? {} : { v: value }) }, currentItems: [] };
}

function row(comparator: Comparator, value?: ConditionRow['value']): ConditionRow {
  return { token: { stepId: 's1', output: 'v' }, comparator, value };
}

/** evalConditions([singleRow], 'all', ctx) as a single-condition check. */
function evalOne(ctx: TokenContext, comparator: Comparator, value?: ConditionRow['value']): boolean {
  return evalConditions([row(comparator, value)], 'all', ctx);
}

describe('evalConditions — typed comparators', () => {
  it('is/is_not compare text', () => {
    const ctx = ctxFor('hello');
    expect(evalOne(ctx, 'is', 'hello')).toBe(true);
    expect(evalOne(ctx, 'is', 'world')).toBe(false);
    expect(evalOne(ctx, 'is_not', 'world')).toBe(true);
    expect(evalOne(ctx, 'is_not', 'hello')).toBe(false);
  });

  it('starts_with checks a text prefix', () => {
    const ctx = ctxFor('hello world');
    expect(evalOne(ctx, 'starts_with', 'hello')).toBe(true);
    expect(evalOne(ctx, 'starts_with', 'world')).toBe(false);
  });

  it('contains is polymorphic: substring on text, membership on list', () => {
    const textCtx = ctxFor('hello world');
    expect(evalOne(textCtx, 'contains', 'wor')).toBe(true);
    expect(evalOne(textCtx, 'contains', 'zzz')).toBe(false);

    const listCtx = ctxFor(['a', 'b', 'c']);
    expect(evalOne(listCtx, 'contains', 'b')).toBe(true);
    expect(evalOne(listCtx, 'contains', 'z')).toBe(false);
  });

  it('eq/lt/gt compare numerically with string-number coercion', () => {
    const ctx = ctxFor('5');
    expect(evalOne(ctx, 'eq', 5)).toBe(true);
    expect(evalOne(ctx, 'eq', 6)).toBe(false);
    expect(evalOne(ctx, 'lt', 10)).toBe(true);
    expect(evalOne(ctx, 'gt', 10)).toBe(false);
    expect(evalOne(ctx, 'gt', 1)).toBe(true);
  });

  it('is_empty/not_empty operate on lists', () => {
    expect(evalOne(ctxFor([]), 'is_empty')).toBe(true);
    expect(evalOne(ctxFor(['a']), 'is_empty')).toBe(false);
    expect(evalOne(ctxFor(['a']), 'not_empty')).toBe(true);
    expect(evalOne(ctxFor([]), 'not_empty')).toBe(false);
  });

  it('is_one_of checks membership in the array value, with string-number coercion', () => {
    const ctx = ctxFor('s');
    expect(evalOne(ctx, 'is_one_of', ['xs', 's'])).toBe(true);
    expect(evalOne(ctx, 'is_one_of', ['xs', 'm'])).toBe(false);

    const numericCtx = ctxFor(2);
    expect(evalOne(numericCtx, 'is_one_of', ['1', '2', '3'])).toBe(true);
  });

  it('a null/undefined operand never throws and evaluates every comparator false', () => {
    const ctx = ctxFor(undefined);
    const comparators: Comparator[] = [
      'is',
      'is_not',
      'contains',
      'starts_with',
      'eq',
      'lt',
      'gt',
      'is_empty',
      'not_empty',
      'is_one_of',
    ];
    for (const comparator of comparators) {
      const value = comparator === 'is_one_of' ? ['a'] : 'a';
      expect(() => evalOne(ctx, comparator, value)).not.toThrow();
      expect(evalOne(ctx, comparator, value)).toBe(false);
    }
  });

  it('scalar comparators reject an array operand outright, instead of stringify-coercing it', () => {
    const ctx = ctxFor(['a', 'b']);
    expect(evalOne(ctx, 'is', 'a,b')).toBe(false);
    expect(evalOne(ctx, 'is_not', 'a,b')).toBe(false);
    expect(evalOne(ctx, 'starts_with', 'a,')).toBe(false);
    expect(evalOne(ctx, 'eq', 'a,b')).toBe(false);
    expect(evalOne(ctx, 'lt', 'a,b')).toBe(false);
    expect(evalOne(ctx, 'gt', 'a,b')).toBe(false);
  });

  it('scalar comparators reject an array value outright, instead of Number()-coercing a single-item array', () => {
    const ctx = ctxFor(5);
    expect(evalOne(ctx, 'is', ['5'])).toBe(false);
    expect(evalOne(ctx, 'is_not', ['5'])).toBe(false);
    expect(evalOne(ctx, 'eq', ['5'])).toBe(false);
    expect(evalOne(ctx, 'lt', ['10'])).toBe(false);
    expect(evalOne(ctx, 'gt', ['1'])).toBe(false);
  });

  it('contains/is_one_of/is_empty/not_empty keep their array-aware semantics unchanged', () => {
    const listCtx = ctxFor(['a', 'b']);
    expect(evalOne(listCtx, 'contains', 'a')).toBe(true);
    expect(evalOne(ctxFor('s'), 'is_one_of', ['xs', 's'])).toBe(true);
    expect(evalOne(ctxFor([]), 'is_empty')).toBe(true);
    expect(evalOne(ctxFor(['a']), 'not_empty')).toBe(true);
  });

  it('evalConditions ANDs rows with "all" and ORs with "any"', () => {
    const ctx = ctxFor('hello');
    const rows: ConditionRow[] = [row('is', 'hello'), row('is', 'nope')];
    expect(evalConditions(rows, 'all', ctx)).toBe(false);
    expect(evalConditions(rows, 'any', ctx)).toBe(true);
  });
});
