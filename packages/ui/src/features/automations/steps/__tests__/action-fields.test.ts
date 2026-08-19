/**
 * action-fields — the UI-local `ActionCatalogEntry.paramsSchema` shape
 * (contract's `unknown`) + defensive narrowing. TDD: test written first,
 * implemented after.
 */
import { describe, expect, it } from 'vitest';
import { asActionParamsSchema, singlePart } from '../action-fields';

describe('asActionParamsSchema', () => {
  it('reads `fields`/`hasOutputAs` off a real daemon-shaped catalog entry, ignoring the JSON-Schema `paramsSchema` sibling', () => {
    // Verbatim shape of `GET /api/automation-actions` (Part 0 of the
    // 2026-08-18 automations-provider-connections plan): `paramsSchema` is
    // real JSON Schema, `fields` is the editor's field schema.
    const entry = {
      id: 'run_command',
      paramsSchema: {
        type: 'object',
        properties: {
          script: { type: 'array', minItems: 1 },
          runIn: { type: 'string', enum: ['project root', 'worktree', 'custom'] },
        },
        required: ['script', 'runIn'],
      },
      fields: [
        { key: 'script', label: 'Script', control: 'code' },
        { key: 'runIn', label: 'Run in', control: 'select', options: ['project root', 'worktree', 'custom'] },
      ],
      hasOutputAs: true,
    };
    const schema = asActionParamsSchema(entry);
    expect(schema.fields).toEqual([
      { key: 'script', label: 'Script', control: 'code' },
      { key: 'runIn', label: 'Run in', control: 'select', options: ['project root', 'worktree', 'custom'] },
    ]);
    expect(schema.hasOutputAs).toBe(true);
  });

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
