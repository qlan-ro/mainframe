// packages/core/src/__tests__/workflows/verify.test.ts
import { describe, it, expect } from 'vitest';
import { parseWorkflowYaml } from '../../workflows/dsl/parse.js';
import { verifyWorkflow } from '../../workflows/dsl/verify.js';

function errorsOf(yaml: string): string[] {
  return verifyWorkflow(parseWorkflowYaml(yaml)).map((e) => e.message);
}

const HEADER = 'version: 1\nname: t\n';

describe('verifyWorkflow', () => {
  it('accepts valid sibling references', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: a
    set:
      v: 1
  - id: b
    set:
      v: "\${ a.output.v }"
`),
    ).toEqual([]);
  });

  it('rejects forward references', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: a
    set:
      v: "\${ b.output.v }"
  - id: b
    set:
      v: 1
`)[0],
    ).toMatch(/'b' is not in scope/);
  });

  it('rejects references to ids inside a sibling choose arm (no leaking)', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: gate
    choose:
      - when: "\${ true }"
        steps:
          - id: inner
            set:
              v: 1
  - id: after
    set:
      v: "\${ inner.output.v }"
`)[0],
    ).toMatch(/'inner' is not in scope/);
  });

  it('allows inner steps to see outer earlier siblings', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: a
    set:
      v: 1
  - id: gate
    choose:
      - when: "\${ a.output.v = 1 }"
        steps:
          - id: inner
            set:
              v: "\${ a.output.v }"
`),
    ).toEqual([]);
  });

  it('rejects duplicate ids in the same scope', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: a
    set:
      v: 1
  - id: a
    set:
      v: 2
`)[0],
    ).toMatch(/duplicate step id 'a'/);
  });

  it('allows same id across parallel branches', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: fan
    parallel:
      x:
        - id: same
          set:
            v: 1
      y:
        - id: same
          set:
            v: 2
`),
    ).toEqual([]);
  });

  it('checks workflow outputs against root scope', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: a
    set:
      v: 1
outputs:
  bad: "\${ nope.output }"
`)[0],
    ).toMatch(/'nope' is not in scope/);
  });

  it('accepts workflow outputs that reference a root step id', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: a
    set:
      v: 1
outputs:
  result: "\${ a.output.v }"
`),
    ).toEqual([]);
  });

  it('allows foreach body to see the loop variable', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: loop
    foreach: "\${ [1,2,3] }"
    as: n
    steps:
      - id: echo
        set:
          v: "\${ n }"
`),
    ).toEqual([]);
  });

  it('allows foreach body to see outer earlier siblings', () => {
    expect(
      errorsOf(`${HEADER}steps:
  - id: base
    set:
      v: 10
  - id: loop
    foreach: "\${ [1,2,3] }"
    steps:
      - id: echo
        set:
          v: "\${ base.output.v }"
`),
    ).toEqual([]);
  });
});
