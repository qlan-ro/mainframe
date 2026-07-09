/**
 * wf-validate-map — TDD tests (Task 21, Finding 4c).
 *
 * Covers:
 * - splitJoinedErrorMessage splits a WorkflowParseError-style joined string
 * - parseStepAddressedMessage parses a zod index-path message into a WfStepPath + message
 * - parseStepAddressedMessage returns null for a message with no index path
 * - parseFallbackStepId extracts the `step '<id>'` substring
 * - mapValidationErrorsToSteps: primary index-path resolution (nested choose arm)
 * - mapValidationErrorsToSteps: fallback step-id substring resolution
 * - mapValidationErrorsToSteps: an unmappable message surfaces in `unmapped`
 */
import { describe, it, expect } from 'vitest';
import {
  splitJoinedErrorMessage,
  parseStepAddressedMessage,
  parseFallbackStepId,
  mapValidationErrorsToSteps,
} from '@/features/workflows/editor/wf-validate-map';
import type { WfDraft } from '@/features/workflows/editor/wf-draft-types';

function makeDraft(): WfDraft {
  return {
    name: 'wf',
    description: '',
    scope: 'project',
    triggers: [],
    inputs: [],
    vars: [],
    steps: [
      { id: 'first', kind: 'set', set: { v: 1 } },
      {
        id: 'route',
        kind: 'choose',
        arms: [
          { when: 'true', steps: [{ id: 'gather', kind: 'set', set: { v: 2 } }] },
          { else: true, steps: [] },
        ],
      },
    ],
    outputs: [],
  };
}

describe('splitJoinedErrorMessage', () => {
  it('splits a "; "-joined WorkflowParseError message into individual entries', () => {
    expect(splitJoinedErrorMessage('steps.0: bad; steps.1: worse')).toEqual(['steps.0: bad', 'steps.1: worse']);
  });

  it('returns a single-element array for an unjoined message', () => {
    expect(splitJoinedErrorMessage('steps.0: bad')).toEqual(['steps.0: bad']);
  });
});

describe('parseStepAddressedMessage', () => {
  it('parses a top-level step index path', () => {
    expect(parseStepAddressedMessage('steps.0: Required')).toEqual({ path: [0], message: 'Required' });
  });

  it('parses a nested choose-arm step index path', () => {
    expect(parseStepAddressedMessage('steps.1.choose.0.steps.0: Required')).toEqual({
      path: [1, { arm: 0 }, 0],
      message: 'Required',
    });
  });

  it('parses a nested foreach body step index path', () => {
    expect(parseStepAddressedMessage('steps.2.steps.3: Required')).toEqual({
      path: [2, 3],
      message: 'Required',
    });
  });

  it('parses a nested parallel branch step index path', () => {
    expect(parseStepAddressedMessage('steps.0.parallel.a.1: Required')).toEqual({
      path: [0, { branch: 'a' }, 1],
      message: 'Required',
    });
  });

  it('returns null when the message has no "steps.N" index-path prefix', () => {
    expect(parseStepAddressedMessage(`'root' is not in scope (step 'gather')`)).toBeNull();
  });
});

describe('parseFallbackStepId', () => {
  it(`extracts the id from a "step '<id>'" substring`, () => {
    expect(parseFallbackStepId(`'root' is not in scope (step 'gather')`)).toBe('gather');
  });

  it('returns null when there is no step id substring', () => {
    expect(parseFallbackStepId('invalid YAML: unexpected token')).toBeNull();
  });
});

describe('mapValidationErrorsToSteps', () => {
  it('maps a primary index-path message to the step it addresses, not by id substring', () => {
    const result = mapValidationErrorsToSteps(['steps.1.choose.0.steps.0: must have exactly one kind'], makeDraft());
    expect(result.stepErrors).toEqual({ gather: 'must have exactly one kind' });
    expect(result.unmapped).toEqual([]);
  });

  it('falls back to the step-id substring when no index path is present', () => {
    const result = mapValidationErrorsToSteps([`'root' is not in scope (step 'gather')`], makeDraft());
    expect(result.stepErrors).toEqual({ gather: `'root' is not in scope (step 'gather')` });
    expect(result.unmapped).toEqual([]);
  });

  it('surfaces a message that resolves via neither path in unmapped', () => {
    const result = mapValidationErrorsToSteps(['invalid YAML: unexpected token'], makeDraft());
    expect(result.stepErrors).toEqual({});
    expect(result.unmapped).toEqual(['invalid YAML: unexpected token']);
  });

  it('handles multiple messages, some mapped and some not', () => {
    const result = mapValidationErrorsToSteps(
      ['steps.0: Required', `'x' is not in scope (step 'gather')`, 'totally unrelated'],
      makeDraft(),
    );
    expect(result.stepErrors).toEqual({ first: 'Required', gather: `'x' is not in scope (step 'gather')` });
    expect(result.unmapped).toEqual(['totally unrelated']);
  });
});
