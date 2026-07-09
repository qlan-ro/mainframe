/**
 * yaml-parse — TDD tests for the canonical YAML → WfDraft inverse mapper.
 *
 * Tests written FIRST, driven off the canonical fixtures (grammar-generated
 * input) rather than the serializer's own output.
 */
import { describe, it, expect } from 'vitest';
import { parseWorkflowToDraft } from '@/features/workflows/editor/yaml-parse';
import { CANONICAL_FIXTURES } from './fixtures';

const byName = (n: string) => CANONICAL_FIXTURES.find((f) => f.name === n)!.yaml;

describe('parseWorkflowToDraft', () => {
  it('maps form: to model kind form', () => {
    const r = parseWorkflowToDraft(byName('form'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.steps[0]?.kind).toBe('form');
  });

  it('maps legacy question: to model kind form too', () => {
    const r = parseWorkflowToDraft(byName('question-legacy'));
    if (r.ok) expect(r.draft.steps[0]?.kind).toBe('form');
  });

  it('maps connector: to service kind', () => {
    const r = parseWorkflowToDraft(byName('service'));
    if (r.ok && r.draft.steps[0]?.kind === 'service') expect(r.draft.steps[0].connector).toBe('files.append');
  });

  it('maps the canonical event trigger', () => {
    const r = parseWorkflowToDraft(byName('triggers-event'));
    if (r.ok) expect(r.draft.triggers[0]).toMatchObject({ kind: 'event', on: expect.any(String) });
  });

  it('flags a full-line comment-bearing file', () => {
    const r = parseWorkflowToDraft('version: 1\nname: x\n# a comment\nsteps:\n  - id: s\n    set: { a: 1 }');
    if (r.ok) expect(r.hasComments).toBe(true);
  });

  it('flags a trailing inline comment (not just full-line comments)', () => {
    const r = parseWorkflowToDraft('version: 1\nname: x # inline note\nsteps:\n  - id: s\n    set: { a: 1 }');
    if (r.ok) expect(r.hasComments).toBe(true);
  });

  it('does not false-positive on a literal "#" inside a quoted scalar', () => {
    const r = parseWorkflowToDraft('version: 1\nname: "x #not-a-comment"\nsteps:\n  - id: s\n    set: { a: 1 }');
    if (r.ok) expect(r.hasComments).toBe(false);
  });

  it('returns ok:false on malformed YAML', () => {
    expect(parseWorkflowToDraft(':::not yaml').ok).toBe(false);
  });

  it('returns ok:false for a step declaring both form: and question:, never picking one', () => {
    const r = parseWorkflowToDraft(
      'version: 1\nname: x\nsteps:\n  - id: ask\n    form: { title: New, fields: [] }\n    question: { title: Old, fields: [] }',
    );
    expect(r.ok).toBe(false);
  });

  it('normalizes absent triggers/inputs/vars/outputs to [] (never undefined) and defaults scope', () => {
    const r = parseWorkflowToDraft(byName('minimal')); // no triggers/inputs/vars/outputs
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.triggers).toEqual([]);
    expect(r.draft.inputs).toEqual([]);
    expect(r.draft.vars).toEqual([]);
    expect(r.draft.outputs).toEqual([]);
    expect(r.draft.scope).toBe('project');
  });
});
