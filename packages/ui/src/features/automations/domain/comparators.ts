/**
 * Comparators by token type (ts153 wf2-base.jsx `WF2_COMPARATORS`, ported
 * onto the exact contract `Comparator` enum, contract §1/A3). There is no
 * dedicated "not equal" comparator — `is_not` is the generic negated-equality
 * op, reused for numbers too.
 */
import type { Comparator } from '../contract';
import type { TokenValueType } from './tokens';

const BY_TYPE: Record<TokenValueType, Comparator[]> = {
  text: ['is', 'is_not', 'contains', 'starts_with', 'is_one_of'],
  choice: ['is', 'is_not', 'is_one_of'],
  number: ['eq', 'is_not', 'lt', 'gt'],
  list: ['is_empty', 'not_empty', 'contains'],
  date: ['is', 'is_not', 'lt', 'gt'],
  object: ['is_empty', 'not_empty'],
};

export function comparatorsFor(type: TokenValueType): Comparator[] {
  return BY_TYPE[type];
}

const NO_VALUE_COMPARATORS = new Set<Comparator>(['is_empty', 'not_empty']);

/** `is_empty`/`not_empty` hide the value editor entirely. */
export function comparatorNeedsValue(comparator: Comparator): boolean {
  return !NO_VALUE_COMPARATORS.has(comparator);
}

const MULTI_VALUE_COMPARATORS = new Set<Comparator>(['is_one_of']);

/** A3: `is_one_of` is the only comparator whose value is an array. */
export function isMultiValue(comparator: Comparator): boolean {
  return MULTI_VALUE_COMPARATORS.has(comparator);
}
