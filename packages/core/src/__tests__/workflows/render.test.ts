// packages/core/src/__tests__/workflows/render.test.ts
import { describe, it, expect } from 'vitest';
import { renderValue, extractRefRoots } from '../../workflows/template/render.js';

const scope = {
  vars: { today: '2026-06-12' },
  ask: { output: { temperature: 37.5, symptoms: ['cough'] } },
};

describe('renderValue', () => {
  it('whole-expression strings keep their type', async () => {
    expect(await renderValue('${ ask.output.temperature }', scope)).toBe(37.5);
    expect(await renderValue('${ ask.output.symptoms }', scope)).toEqual(['cough']);
  });

  it('mixed strings interpolate', async () => {
    expect(await renderValue('Temp: ${ask.output.temperature}C on ${vars.today}', scope)).toBe(
      'Temp: 37.5C on 2026-06-12',
    );
  });

  it('renders nested objects', async () => {
    expect(await renderValue({ a: '${ ask.output.temperature }', b: ['${vars.today}'] }, scope)).toEqual({
      a: 37.5,
      b: ['2026-06-12'],
    });
  });

  it('supports JSONata functions and defaults', async () => {
    expect(await renderValue("${ $join(ask.output.symptoms, ', ') }", scope)).toBe('cough');
    expect(await renderValue('${ missing.output ?? "fallback" }', { ...scope, missing: null })).toBe('fallback');
  });

  it('throws on a reference to an unknown root name', async () => {
    await expect(renderValue('${ ghost.output.x }', scope)).rejects.toThrow(/unknown reference 'ghost'/);
  });
});

describe('extractRefRoots', () => {
  it('finds root names used in an expression', () => {
    expect(extractRefRoots("a ${ask.output.x} b ${ $join(vars.list, '-') }")).toEqual(
      expect.arrayContaining(['ask', 'vars']),
    );
  });
});
