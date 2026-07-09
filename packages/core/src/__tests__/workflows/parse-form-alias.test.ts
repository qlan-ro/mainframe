import { describe, it, expect } from 'vitest';
import { parseWorkflowYaml, WorkflowParseError } from '../../workflows/dsl/parse.js';

const withForm = `
version: 1
name: form-alias
steps:
  - id: gather
    form:
      title: Details
      fields:
        - { key: name, type: text }
`;

describe('form: alias', () => {
  it('normalizes a top-level form: step to the internal question StepDef', () => {
    const def = parseWorkflowYaml(withForm);
    const step = def.steps[0] as unknown as Record<string, unknown>;
    expect(step['question']).toBeDefined();
    expect(step['form']).toBeUndefined();
    expect((step['question'] as { title: string }).title).toBe('Details');
  });

  it('normalizes form: nested inside a foreach', () => {
    const def = parseWorkflowYaml(`
version: 1
name: nested-form
steps:
  - id: loop
    foreach: \${ inputs.items }
    as: item
    steps:
      - id: ask
        form:
          title: Q
          fields:
            - { key: a, type: text }
`);
    const inner = (def.steps[0] as unknown as { steps: Array<Record<string, unknown>> }).steps[0];
    expect(inner['question']).toBeDefined();
    expect(inner['form']).toBeUndefined();
  });

  it('still accepts question: unchanged', () => {
    const def = parseWorkflowYaml(`
version: 1
name: legacy
steps:
  - id: ask
    question:
      title: Legacy
      fields:
        - { key: a, type: text }
`);
    expect((def.steps[0] as unknown as Record<string, unknown>)['question']).toBeDefined();
  });

  it('rejects a step that declares both form: and question: rather than silently picking one', () => {
    // desugarForm must NOT blindly overwrite `question` when both keys are present on
    // the same step -- that would silently discard one body instead of surfacing the
    // authoring mistake. It leaves the step untouched so stepSchema's own `.strict()`
    // rejects the stray, unrecognized `form` key exactly as it already does today.
    expect(() =>
      parseWorkflowYaml(`
version: 1
name: conflicting
steps:
  - id: ask
    form:
      title: New
      fields:
        - { key: a, type: text }
    question:
      title: Old
      fields:
        - { key: a, type: text }
`),
    ).toThrow(WorkflowParseError);
  });
});
