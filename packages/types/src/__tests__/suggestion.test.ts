import { describe, it, expect } from 'vitest';
import { SuggestionSchema, SuggestionListSchema, type Suggestion } from '../suggestion.js';

const valid: Suggestion = {
  icon: 'git-compare',
  tint: 'accent',
  title: 'Review the working changes',
  meta: 'git · 3 files',
  prefill: 'Review the uncommitted changes.',
};

describe('SuggestionSchema', () => {
  it('accepts a well-formed suggestion', () => {
    expect(SuggestionSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown tint', () => {
    expect(SuggestionSchema.safeParse({ ...valid, tint: 'green' }).success).toBe(false);
  });

  it('rejects a missing prefill', () => {
    const { prefill: _drop, ...rest } = valid;
    expect(SuggestionSchema.safeParse(rest).success).toBe(false);
  });

  it('parses an array of suggestions and rejects a non-array', () => {
    expect(SuggestionListSchema.parse([valid, valid])).toHaveLength(2);
    expect(SuggestionListSchema.safeParse(valid).success).toBe(false);
  });
});
