// packages/core/src/automations/engine/comparators.ts
//
// Typed comparator matrix for If blocks (contract §1, A3). `contains` is
// polymorphic (text substring / list membership); `is_one_of` is the
// opposite direction (a scalar operand tested against an array value). A
// null/undefined operand (unset token, or one from a skipped branch) never
// throws — every comparator evaluates it as false.
import type { Comparator, ConditionRow } from '@qlan-ro/mainframe-types';
import { resolveToken, type TokenContext } from '../tokens/substitute.js';

export function evalConditions(rows: ConditionRow[], match: 'all' | 'any', ctx: TokenContext): boolean {
  return match === 'all' ? rows.every((row) => evalCondition(ctx, row)) : rows.some((row) => evalCondition(ctx, row));
}

function evalCondition(ctx: TokenContext, row: ConditionRow): boolean {
  const operand = resolveToken(ctx, row.token);
  if (operand === null || operand === undefined) return false;
  return compare(operand, row.comparator, row.value);
}

function compare(operand: unknown, comparator: Comparator, value: ConditionRow['value']): boolean {
  switch (comparator) {
    case 'is':
      return String(operand) === String(value);
    case 'is_not':
      return String(operand) !== String(value);
    case 'starts_with':
      return String(operand).startsWith(String(value));
    case 'contains':
      return Array.isArray(operand)
        ? operand.some((item) => String(item) === String(value))
        : String(operand).includes(String(value));
    case 'eq':
      return Number(operand) === Number(value);
    case 'lt':
      return Number(operand) < Number(value);
    case 'gt':
      return Number(operand) > Number(value);
    case 'is_empty':
      return isEmpty(operand);
    case 'not_empty':
      return !isEmpty(operand);
    case 'is_one_of':
      return Array.isArray(value) && value.some((item) => String(item) === String(operand));
  }
}

function isEmpty(operand: unknown): boolean {
  if (Array.isArray(operand)) return operand.length === 0;
  if (typeof operand === 'string') return operand.length === 0;
  return false;
}
