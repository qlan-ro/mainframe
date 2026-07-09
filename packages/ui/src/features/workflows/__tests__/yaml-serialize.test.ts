/**
 * yaml-serialize — TDD tests for the object-mapping YAML serializer.
 *
 * Tests written FIRST, against the v2 WfDraft union. Assertions parse the
 * output back with `yaml` and check the resulting object shape rather than
 * matching raw text, since `YAML.stringify` owns formatting decisions.
 */
import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { serializeWorkflow, draftToObject } from '@/features/workflows/editor/yaml-serialize';
import { blankDraft } from '@/features/workflows/editor/wf-stubs';
import type { WfDraft } from '@/features/workflows/editor/wf-draft-types';

const draft: WfDraft = {
  name: 'My Flow',
  description: 'demo',
  scope: 'project',
  triggers: [{ kind: 'event', on: 'chat.completed', workflow: 'x' }],
  inputs: [{ name: 'items', type: 'array' }],
  vars: [{ key: 'greeting', value: 'hi' }],
  outputs: [{ name: 'result', expr: '${ steps.gather.output }' }],
  steps: [{ id: 'gather', kind: 'form', form: { title: 'Q', fields: [{ key: 'a', type: 'text' }] } }],
};

describe('serializeWorkflow', () => {
  it('slugs the name and emits version 1', () => {
    const obj = parseYaml(serializeWorkflow(draft));
    expect(obj.version).toBe(1);
    expect(obj.name).toBe('my-flow');
  });

  it('emits the event trigger as a canonical object, not a bare string', () => {
    const obj = parseYaml(serializeWorkflow(draft));
    expect(obj.triggers[0].event).toEqual({ on: 'chat.completed', workflow: 'x' });
  });

  it('emits the form step under the form: key (alias)', () => {
    const obj = parseYaml(serializeWorkflow(draft));
    expect(obj.steps[0].form.title).toBe('Q');
    expect(obj.steps[0].question).toBeUndefined();
  });

  it('never emits the scope field (schema is .strict())', () => {
    const obj = parseYaml(serializeWorkflow(draft));
    expect(obj.scope).toBeUndefined();
  });

  it('blankDraft round-trips to a valid empty steps skeleton', () => {
    const obj = parseYaml(serializeWorkflow({ ...blankDraft(), steps: draft.steps }));
    expect(obj.steps).toHaveLength(1);
  });

  it('emits inputs/vars as maps, not arrays', () => {
    const obj = parseYaml(serializeWorkflow(draft));
    expect(obj.inputs).toEqual({ items: { type: 'array' } });
    expect(obj.vars).toEqual({ greeting: 'hi' });
  });

  it('emits outputs as a name->expr map', () => {
    const obj = parseYaml(serializeWorkflow(draft));
    expect(obj.outputs).toEqual({ result: '${ steps.gather.output }' });
  });

  it('omits triggers/inputs/vars/outputs keys entirely when the collections are empty', () => {
    const obj = parseYaml(serializeWorkflow(blankDraft()));
    expect(obj.triggers).toBeUndefined();
    expect(obj.inputs).toBeUndefined();
    expect(obj.vars).toBeUndefined();
    expect(obj.outputs).toBeUndefined();
  });

  it('omits a manual-only trigger list (manual never appears on disk)', () => {
    const obj = parseYaml(serializeWorkflow({ ...blankDraft(), triggers: [{ kind: 'manual' }], steps: draft.steps }));
    expect(obj.triggers).toBeUndefined();
  });

  it('emits a schedule trigger with cron and on_missed, dropping the UI-only label', () => {
    const obj = parseYaml(
      serializeWorkflow({
        ...blankDraft(),
        triggers: [{ kind: 'schedule', cron: '0 9 * * *', on_missed: 'run_once', label: 'Daily' }],
        steps: draft.steps,
      }),
    );
    expect(obj.triggers[0]).toEqual({ schedule: { cron: '0 9 * * *', on_missed: 'run_once' } });
  });

  it('never emits null placeholder lines for absent optional step fields', () => {
    const yaml = serializeWorkflow({
      ...blankDraft(),
      steps: [{ id: 'ag', kind: 'agent', agent: { prompt: 'hi' } }],
    });
    expect(yaml).not.toMatch(/:\s*null/);
    const obj = parseYaml(yaml);
    expect(obj.steps[0].agent).toEqual({ prompt: 'hi' });
  });

  it('serializes a service step under connector/with/credential', () => {
    const obj = parseYaml(
      serializeWorkflow({
        ...blankDraft(),
        steps: [{ id: 'svc', kind: 'service', connector: 'files.append', with: { path: 'a.md' }, credential: 'c' }],
      }),
    );
    expect(obj.steps[0]).toMatchObject({ connector: 'files.append', with: { path: 'a.md' }, credential: 'c' });
  });

  it('serializes a choose step with when/else arms', () => {
    const obj = parseYaml(
      serializeWorkflow({
        ...blankDraft(),
        steps: [
          {
            id: 'b',
            kind: 'choose',
            arms: [
              { when: '${ x }', steps: [{ id: 'a', kind: 'set', set: { v: 1 } }] },
              { else: true, steps: [{ id: 'z', kind: 'set', set: { v: 2 } }] },
            ],
          },
        ],
      }),
    );
    expect(obj.steps[0].choose[0]).toMatchObject({ when: '${ x }' });
    expect(obj.steps[0].choose[1]).toMatchObject({ else: true });
  });

  it('serializes a foreach step with over/as/steps', () => {
    const obj = parseYaml(
      serializeWorkflow({
        ...blankDraft(),
        steps: [{ id: 'l', kind: 'foreach', over: '${ items }', as: 'item', steps: [] }],
      }),
    );
    expect(obj.steps[0]).toMatchObject({ foreach: '${ items }', as: 'item', steps: [] });
  });

  it('serializes a parallel step as a branches record', () => {
    const obj = parseYaml(
      serializeWorkflow({
        ...blankDraft(),
        steps: [{ id: 'p', kind: 'parallel', branches: { a: [], b: [] } }],
      }),
    );
    expect(obj.steps[0].parallel).toEqual({ a: [], b: [] });
  });

  it('serializes a call step with ref and with', () => {
    const obj = parseYaml(
      serializeWorkflow({
        ...blankDraft(),
        steps: [{ id: 'c', kind: 'call', ref: 'other-wf', with: { topic: 'x' } }],
      }),
    );
    expect(obj.steps[0]).toMatchObject({ call: 'other-wf', with: { topic: 'x' } });
  });

  it('emits on_failure (snake_case) for the model onFailure field', () => {
    const obj = parseYaml(
      serializeWorkflow({
        ...blankDraft(),
        steps: [{ id: 's', kind: 'set', set: { a: 1 }, onFailure: 'continue' }],
      }),
    );
    expect(obj.steps[0].on_failure).toBe('continue');
  });

  it('auto-quotes a form title containing a colon and a hash', () => {
    const yaml = serializeWorkflow({
      ...blankDraft(),
      steps: [{ id: 'q', kind: 'form', form: { title: 'has: colon # hash', fields: [] } }],
    });
    const obj = parseYaml(yaml);
    expect(obj.steps[0].form.title).toBe('has: colon # hash');
  });

  it('draftToObject exposes the plain object used by serializeWorkflow', () => {
    const obj = draftToObject(draft);
    expect(obj['version']).toBe(1);
    expect(obj['name']).toBe('my-flow');
  });
});
