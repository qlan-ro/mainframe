// packages/core/src/__tests__/workflows/dsl-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseWorkflowYaml } from '../../workflows/dsl/parse.js';

// All step kinds in canonical grammar:
//   connector, agent, question, set, choose, foreach, parallel, call
const GOOD = `
version: 1
name: demo
inputs:
  who: { type: string }
triggers:
  - schedule: { cron: "0 8 * * 1-5", on_missed: skip }
vars:
  greeting: "hello"
steps:
  - id: ask
    question:
      title: "How are you feeling?"
      timeout: 720
      fields:
        - key: mood
          type: choice
          label: "Your mood"
          options: [happy, sad, neutral]
          required: true
        - key: details
          type: textarea
          label: "Tell us more"
          when:
            key: mood
            equals: sad
  - id: branch
    choose:
      - when: "\${ ask.output.mood = 'happy' }"
        steps:
          - id: note
            connector: files.append
            with:
              path: "~/x.md"
              content: "\${vars.greeting}"
      - else: true
        steps:
          - id: warn
            set:
              level: "low"
    output: "\${ note.output ?? null }"
  - id: every
    foreach: "\${ [1,2,3] }"
    as: n
    steps:
      - id: echo
        set:
          value: "\${ n * 2 }"
  - id: fan
    parallel:
      a:
        - id: one
          set:
            value: 1
      b:
        - id: two
          set:
            value: 2
  - id: sub
    call: other-workflow
    with:
      x: 1
outputs:
  mood: "\${ ask.output.mood }"
`;

// Sugar form: { if, then, else? } -> desugared to choose
const IF_SUGAR = `
version: 1
name: sugar-demo
steps:
  - id: gate
    if: "\${ true }"
    then:
      - id: yes
        set:
          v: 1
    else:
      - id: no
        set:
          v: 2
`;

describe('parseWorkflowYaml', () => {
  it('parses every step kind in canonical grammar', () => {
    const def = parseWorkflowYaml(GOOD);
    expect(def.name).toBe('demo');
    expect(def.steps.map((s) => s.id)).toEqual(['ask', 'branch', 'every', 'fan', 'sub']);

    // question step with fields
    const ask = def.steps[0];
    if (!('question' in ask)) throw new Error('expected question step');
    expect(ask.question.title).toBe('How are you feeling?');
    expect(ask.question.fields).toHaveLength(2);
    expect(ask.question.fields[0]?.key).toBe('mood');
    expect(ask.question.fields[0]?.type).toBe('choice');
    expect(ask.question.fields[1]?.when).toEqual({ key: 'mood', equals: 'sad' });

    // choose step with when/else + steps
    const branch = def.steps[1];
    if (!('choose' in branch)) throw new Error('expected choose step');
    expect(branch.choose).toHaveLength(2);
    expect(branch.choose[0]?.when).toBeDefined();
    expect(branch.choose[0]?.steps).toHaveLength(1);
    expect(branch.choose[1]?.else).toBe(true);
    expect(branch.choose[1]?.steps).toHaveLength(1);

    // connector step nested inside choose
    const note = branch.choose[0]?.steps[0];
    if (!note || !('connector' in note)) throw new Error('expected connector step');
    expect(note.connector).toBe('files.append');

    // foreach with as + steps
    const every = def.steps[2];
    if (!('foreach' in every)) throw new Error('expected foreach step');
    expect(every.as).toBe('n');
    expect(every.steps).toHaveLength(1);

    // parallel
    const fan = def.steps[3];
    if (!('parallel' in fan)) throw new Error('expected parallel step');
    expect(Object.keys(fan.parallel)).toEqual(['a', 'b']);

    // call with with
    const sub = def.steps[4];
    if (!('call' in sub)) throw new Error('expected call step');
    expect(sub.call).toBe('other-workflow');
    expect(sub.with).toEqual({ x: 1 });

    // outputs
    expect(def.outputs?.['mood']).toBe('${ ask.output.mood }');
  });

  it('rejects a step with two kind keys', () => {
    // 'sub' has call + connector — exactly two kind keys
    const bad = GOOD.replace('call: other-workflow', 'call: other-workflow\n    connector: files.append');
    expect(() => parseWorkflowYaml(bad)).toThrow(/exactly one/i);
  });

  it('rejects unknown top-level fields', () => {
    expect(() => parseWorkflowYaml(GOOD + '\nbogus: 1')).toThrow();
  });

  it('desugars if/then/else to choose', () => {
    const def = parseWorkflowYaml(IF_SUGAR);
    const gate = def.steps[0];
    if (!('choose' in gate)) throw new Error('expected choose after desugar');
    expect(gate.choose).toHaveLength(2);
    expect(gate.choose[0]?.when).toBeDefined();
    expect(gate.choose[0]?.steps[0]?.id).toBe('yes');
    expect(gate.choose[1]?.else).toBe(true);
    expect(gate.choose[1]?.steps[0]?.id).toBe('no');
  });
});
