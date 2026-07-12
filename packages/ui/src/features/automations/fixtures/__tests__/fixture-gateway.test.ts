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

  it('listActions resolves the nine launch actions (Phase 4); listCredentialLabels stays empty (no dev-host auth)', async () => {
    const gateway = createFixtureGateway();
    const actions = await gateway.listActions();
    expect(actions).toHaveLength(9);
    expect(actions.some((a) => a.group === 'mcp')).toBe(false);
    expect(await gateway.listCredentialLabels()).toEqual([]);
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

  it('seeds a demo run per demo automation, each with a matching timeline', async () => {
    const gateway = createFixtureGateway();
    const definitions = await gateway.listAutomations();
    const shipWork = definitions.find((d) => d.name === 'Ship work');
    if (!shipWork) throw new Error('expected the Ship work fixture');

    const runs = await gateway.listRuns(shipWork.id);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    if (!run) throw new Error('expected a seeded demo run');
    expect(run.status).toBe('waiting');

    const timeline = await gateway.getRunTimeline(run.id);
    expect(timeline.map((e) => e.stepRef)).toEqual(['ask-ado-link', 'if-create-new', 'create-pr', 'cleanup-worktree']);
    expect(timeline[0]?.status).toBe('waiting');
    expect(timeline[0]?.interactionId).toBeTruthy();
  });

  it("the Ship work demo run's waiting step has a matching pending interaction with the ask_me fields", async () => {
    const gateway = createFixtureGateway();
    const definitions = await gateway.listAutomations();
    const shipWork = definitions.find((d) => d.name === 'Ship work');
    if (!shipWork) throw new Error('expected the Ship work fixture');
    const [run] = await gateway.listRuns(shipWork.id);
    if (!run) throw new Error('expected a seeded demo run');
    const [timelineEntry] = await gateway.getRunTimeline(run.id);

    const interactions = await gateway.listInteractions();
    const interaction = interactions.find((i) => i.id === timelineEntry?.interactionId);
    expect(interaction).toBeDefined();
    expect(interaction?.status).toBe('pending');
    expect(interaction?.runId).toBe(run.id);
    expect(interaction?.fields.map((f) => f.key)).toEqual(['action', 'adoId', 'title', 'description']);
  });

  it('seeds the Morning PR sweep demo run as running with a repeat fan-out', async () => {
    const gateway = createFixtureGateway();
    const definitions = await gateway.listAutomations();
    const sweep = definitions.find((d) => d.name === 'Morning PR sweep');
    if (!sweep) throw new Error('expected the Morning PR sweep fixture');
    const [run] = await gateway.listRuns(sweep.id);
    if (!run) throw new Error('expected a seeded demo run');
    expect(run.status).toBe('running');

    const timeline = await gateway.getRunTimeline(run.id);
    const fanOut = timeline.filter((e) => e.stepRef.startsWith('ask-review-pr#'));
    expect(fanOut.map((e) => e.stepRef)).toEqual(['ask-review-pr#1', 'ask-review-pr#2', 'ask-review-pr#3']);
    expect(fanOut.map((e) => e.status)).toEqual(['succeeded', 'failed', 'running']);
  });

  it('seeds the PR auto-review demo run as failed', async () => {
    const gateway = createFixtureGateway();
    const definitions = await gateway.listAutomations();
    const review = definitions.find((d) => d.name === 'PR auto-review');
    if (!review) throw new Error('expected the PR auto-review fixture');
    const [run] = await gateway.listRuns(review.id);
    if (!run) throw new Error('expected a seeded demo run');
    expect(run.status).toBe('failed');
    const timeline = await gateway.getRunTimeline(run.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.status).toBe('failed');
    expect(timeline[0]?.error).toBeTruthy();
  });
});
