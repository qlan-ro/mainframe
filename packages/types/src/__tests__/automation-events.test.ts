import { describe, it, expect } from 'vitest';
import type { DaemonEvent } from '../events.js';
import type { AutomationRunSummary, AutomationInteractionSummary } from '../automation.js';

const run: AutomationRunSummary = {
  id: 'run-1',
  automationId: 'automation-1',
  status: 'succeeded',
  trigger: { kind: 'manual' },
  startedAt: 0,
  finishedAt: 1,
  error: null,
};

const interaction: AutomationInteractionSummary = {
  id: 'interaction-1',
  runId: 'run-1',
  stepRef: 'ask-health',
  title: 'Health check-in',
  fields: [],
  status: 'pending',
  createdAt: 0,
  resolvedAt: null,
};

describe('automation.* DaemonEvent variants', () => {
  it('accepts every field the daemon emits for each of the five events', () => {
    const events: DaemonEvent[] = [
      { type: 'automation.run.updated', run },
      { type: 'automation.interaction.created', interaction },
      { type: 'automation.interaction.resolved', interactionId: 'interaction-1', runId: 'run-1' },
      {
        type: 'automation.completed',
        automationId: 'automation-1',
        automationName: 'Daily health log',
        runId: 'run-1',
        status: 'succeeded',
        result: 'done',
      },
      {
        type: 'automation.notification',
        runId: 'run-1',
        automationId: 'automation-1',
        title: 'Run finished',
        body: 'Daily health log finished',
        links: { runId: 'run-1', chatIds: ['chat-1'] },
      },
    ];

    expect(events).toHaveLength(5);
    expect(events.map((event) => event.type)).toEqual([
      'automation.run.updated',
      'automation.interaction.created',
      'automation.interaction.resolved',
      'automation.completed',
      'automation.notification',
    ]);
  });
});
