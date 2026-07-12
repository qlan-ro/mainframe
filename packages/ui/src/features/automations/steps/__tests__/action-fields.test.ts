/**
 * action-fields — the UI-local `ActionCatalogEntry.paramsSchema` shape
 * (contract's `unknown`) + defensive narrowing. TDD: test written first,
 * implemented after.
 */
import { describe, expect, it } from 'vitest';
import { asActionParamsSchema, singlePart } from '../action-fields';

describe('asActionParamsSchema', () => {
  it('narrows a well-formed schema, filtering out malformed field entries', () => {
    const schema = asActionParamsSchema({
      fields: [
        { key: 'script', label: 'Script', control: 'code' },
        { key: 'bad' }, // missing label/control
        'not even an object',
      ],
      hasOutputAs: true,
    });
    expect(schema.fields).toEqual([{ key: 'script', label: 'Script', control: 'code' }]);
    expect(schema.hasOutputAs).toBe(true);
  });

  it('returns an empty schema for non-object input (a foreign/unknown paramsSchema)', () => {
    expect(asActionParamsSchema(null)).toEqual({ fields: [] });
    expect(asActionParamsSchema('nope')).toEqual({ fields: [] });
    expect(asActionParamsSchema(42)).toEqual({ fields: [] });
  });

  it('returns an empty fields array when `fields` is missing or not an array', () => {
    expect(asActionParamsSchema({})).toEqual({ fields: [] });
    expect(asActionParamsSchema({ fields: 'nope' })).toEqual({ fields: [] });
  });
});

describe('singlePart', () => {
  it('reads the literal string from a single-part ChipText', () => {
    expect(singlePart(['project root'])).toBe('project root');
  });

  it('returns empty string for an empty ChipText or a leading token part', () => {
    expect(singlePart([])).toBe('');
    expect(singlePart([{ token: { stepId: 'a', output: 'x' } }])).toBe('');
  });
});
