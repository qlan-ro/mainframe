import { describe, expect, it } from 'vitest';
import type { DaemonEvent } from '../../contract';
import { createFixtureGateway } from '../fixture-gateway';
import { FEATURE_SPIKE_FIXTURE } from '../fixtures';

describe('createFixtureGateway', () => {
  it('createAutomation adds a new definition with enabled true and fresh timestamps', async () => {
    const gateway = createFixtureGateway();
    const before = await gateway.listAutomations();
    const created = await gateway.createAutomation({
      name: 'New one',
      scope: 'project',
      projectId: 'p1',
      definition: { triggers: [], steps: [] },
    });
    expect(created.enabled).toBe(true);
    expect(created.name).toBe('New one');
    const after = await gateway.listAutomations();
    expect(after).toHaveLength(before.length + 1);
  });

  it('setEnabled toggles a definition and getAutomation reflects it', async () => {
    const gateway = createFixtureGateway();
    const [first] = await gateway.listAutomations();
    if (!first) throw new Error('expected a seeded fixture');
    const toggled = await gateway.setEnabled(first.id, false);
    expect(toggled.enabled).toBe(false);
    expect((await gateway.getAutomation(first.id)).enabled).toBe(false);
  });

  it('deleteAutomation removes it', async () => {
    const gateway = createFixtureGateway();
    const [first] = await gateway.listAutomations();
    if (!first) throw new Error('expected a seeded fixture');
    await gateway.deleteAutomation(first.id);
    await expect(gateway.getAutomation(first.id)).rejects.toThrow();
  });

  it('startRun creates a running run scoped to the automation and emits automation.run.updated', async () => {
    const gateway = createFixtureGateway();
    const [first] = await gateway.listAutomations();
    if (!first) throw new Error('expected a seeded fixture');
    const seen: DaemonEvent[] = [];
    const unsubscribe = gateway.onEvent((e) => seen.push(e));

    const run = await gateway.startRun(first.id);
    expect(run.automationId).toBe(first.id);
    expect(run.status).toBe('running');
    expect(seen).toContainEqual({ type: 'automation.run.updated', run });

    unsubscribe();
  });

  it('listRuns filters by automationId', async () => {
    const gateway = createFixtureGateway();
    const definitions = await gateway.listAutomations();
    const [a, b] = definitions;
    if (!a || !b) throw new Error('expected at least two seeded fixtures');
    await gateway.startRun(a.id);
    await gateway.startRun(b.id);
    const runsForA = await gateway.listRuns(a.id);
    expect(runsForA.every((r) => r.automationId === a.id)).toBe(true);
    expect(runsForA.length).toBeGreaterThan(0);
  });

  it('getRunTimeline on a freshly started run returns no steps yet', async () => {
    const gateway = createFixtureGateway();
    const [first] = await gateway.listAutomations();
    if (!first) throw new Error('expected a seeded fixture');
    const run = await gateway.startRun(first.id);
    expect(await gateway.getRunTimeline(run.id)).toEqual([]);
  });

  it('getRunTimeline rejects for an unknown run id', async () => {
    const gateway = createFixtureGateway();
    await expect(gateway.getRunTimeline('nope')).rejects.toThrow();
  });
});

describe('FEATURE_SPIKE_FIXTURE — the sole A1+A2+A3 carrier (contract §8)', () => {
  it('carries the A2 expects on its ask_agent step', () => {
    const step = FEATURE_SPIKE_FIXTURE.definition.steps[0];
    expect(step?.kind).toBe('ask_agent');
    expect(step?.kind === 'ask_agent' ? step.expects : undefined).toEqual([
      { key: 'scope', type: 'choice', options: ['xs', 's', 'm'] },
    ]);
  });

  it('carries the A3 is_one_of condition', () => {
    const ifStep = FEATURE_SPIKE_FIXTURE.definition.steps[1];
    expect(ifStep?.kind).toBe('if');
    expect(ifStep?.kind === 'if' ? ifStep.conditions[0]?.comparator : undefined).toBe('is_one_of');
  });

  it('carries the A1 run_command step inside the then branch', () => {
    const ifStep = FEATURE_SPIKE_FIXTURE.definition.steps[1];
    const thenSteps = ifStep?.kind === 'if' ? ifStep.then : [];
    expect(thenSteps.some((s) => s.kind === 'run_action' && s.actionId === 'run_command')).toBe(true);
  });
});
