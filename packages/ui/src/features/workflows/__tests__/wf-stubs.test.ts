/**
 * wf-stubs — TDD tests for the builder's blank-draft and Add-step/Add-trigger factories.
 *
 * Tests written FIRST, against the v2 WfDraft union.
 */
import { describe, it, expect } from 'vitest';
import { blankDraft, stubStep, stubTrigger } from '@/features/workflows/editor/wf-stubs';
import type { WfStepKind } from '@/features/workflows/editor/wf-draft-types';

const ALL_KINDS: WfStepKind[] = ['agent', 'form', 'service', 'choose', 'foreach', 'parallel', 'call', 'set'];

describe('blankDraft', () => {
  it('returns all-[] collections', () => {
    const d = blankDraft();
    expect(d.triggers).toEqual([]);
    expect(d.inputs).toEqual([]);
    expect(d.vars).toEqual([]);
    expect(d.outputs).toEqual([]);
    expect(d.steps).toEqual([]);
  });

  it('defaults scope to project', () => {
    expect(blankDraft().scope).toBe('project');
  });
});

describe('stubStep', () => {
  it.each(ALL_KINDS)('produces a valid WfStep for kind %s', (kind) => {
    const step = stubStep(kind);
    expect(step.kind).toBe(kind);
    expect(step.id).toMatch(new RegExp(`^${kind}_`));
  });

  it("seeds the form step with the plan's exact shape", () => {
    const step = stubStep('form');
    if (step.kind !== 'form') throw new Error('expected form step');
    expect(step.form).toEqual({ title: 'Ask the user', fields: [{ key: 'answer', type: 'text' }] });
  });

  it('does not seed a worktree on the agent stub', () => {
    const step = stubStep('agent');
    if (step.kind !== 'agent') throw new Error('expected agent step');
    expect(step.agent.worktree).toBeUndefined();
  });

  it('gives two stubbed steps of the same kind distinct ids', () => {
    const a = stubStep('agent');
    const b = stubStep('agent');
    expect(a.id).not.toBe(b.id);
  });
});

describe('stubTrigger', () => {
  it('produces a manual trigger by default', () => {
    expect(stubTrigger('manual')).toEqual({ kind: 'manual' });
  });

  it('produces a schedule trigger with a cron and a UI-only label', () => {
    const t = stubTrigger('schedule');
    if (t.kind !== 'schedule') throw new Error('expected schedule trigger');
    expect(t.cron).toBeTruthy();
    expect(t.label).toBeTruthy();
  });

  it('produces an event trigger with an "on" topic', () => {
    const t = stubTrigger('event');
    if (t.kind !== 'event') throw new Error('expected event trigger');
    expect(t.on).toBeTruthy();
  });
});
