import { describe, expect, it } from 'vitest';
import { comparatorNeedsValue, comparatorsFor, isMultiValue } from '../comparators';

describe('comparatorsFor', () => {
  it('text tokens get is/is_not/contains/starts_with plus is_one_of (A3, value-chip list)', () => {
    expect(comparatorsFor('text')).toEqual(['is', 'is_not', 'contains', 'starts_with', 'is_one_of']);
  });

  it('choice tokens get is/is_not plus is_one_of (A3, multi-select of their own options)', () => {
    expect(comparatorsFor('choice')).toEqual(['is', 'is_not', 'is_one_of']);
  });

  it('number tokens get eq/is_not/lt/gt (no is_one_of)', () => {
    expect(comparatorsFor('number')).toEqual(['eq', 'is_not', 'lt', 'gt']);
  });

  it('list tokens get is_empty/not_empty/contains', () => {
    expect(comparatorsFor('list')).toEqual(['is_empty', 'not_empty', 'contains']);
  });
});

describe('comparatorNeedsValue', () => {
  it('is_empty and not_empty hide the value editor', () => {
    expect(comparatorNeedsValue('is_empty')).toBe(false);
    expect(comparatorNeedsValue('not_empty')).toBe(false);
  });

  it('every other comparator needs a value', () => {
    expect(comparatorNeedsValue('is')).toBe(true);
    expect(comparatorNeedsValue('is_one_of')).toBe(true);
    expect(comparatorNeedsValue('contains')).toBe(true);
  });
});

describe('isMultiValue', () => {
  it('only is_one_of takes an array value', () => {
    expect(isMultiValue('is_one_of')).toBe(true);
    expect(isMultiValue('is')).toBe(false);
    expect(isMultiValue('contains')).toBe(false);
  });
});
