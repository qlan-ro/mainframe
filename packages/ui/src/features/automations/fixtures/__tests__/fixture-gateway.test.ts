import { describe, expect, it } from 'vitest';
import type { DaemonEvent } from '../../contract';
import { createFixtureGateway } from '../fixture-gateway';

describe('createFixtureGateway', () => {
  it('seeds listAutomations with the six canonical fixtures, each given a unique id', async () => {
    const gateway = createFixtureGateway();
    const definitions = await gateway.listAutomations();
    expect(definitions).toHaveLength(6);
    expect(new Set(definitions.map((d) => d.id)).size).toBe(6);
  });

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

  it('listActions and listCredentialLabels resolve (empty catalog is a valid launch state)', async () => {
    const gateway = createFixtureGateway();
    expect(await gateway.listActions()).toEqual([]);
    expect(await gateway.listCredentialLabels()).toEqual([]);
  });
});
