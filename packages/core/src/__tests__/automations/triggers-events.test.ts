// packages/core/src/__tests__/automations/triggers-events.test.ts
import { describe, it, expect } from 'vitest';
import type { Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import { matchEventTriggers, type EventTriggerBinding } from '../../automations/triggers/events.js';

function makeChat(id: string): Chat {
  return {
    id,
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'ended',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
  };
}

const noAgentWaits = () => false;

const sessionBinding: EventTriggerBinding = {
  automationId: 'auto-1',
  triggerId: 'trigger-1',
  event: 'session.finished',
};
const finishedBinding: EventTriggerBinding = {
  automationId: 'auto-2',
  triggerId: 'trigger-2',
  event: 'automation.finished',
};
const failedBinding: EventTriggerBinding = {
  automationId: 'auto-3',
  triggerId: 'trigger-3',
  event: 'automation.failed',
};
const scopedFinishedBinding: EventTriggerBinding = {
  automationId: 'auto-4',
  triggerId: 'trigger-4',
  event: 'automation.finished',
  automationFilter: 'auto-source',
};

describe('matchEventTriggers', () => {
  it('fires session.finished on a terminal chat.updated event with result + chatId tokens', () => {
    const event: DaemonEvent = { type: 'chat.updated', chat: makeChat('chat-1'), reason: 'completed' };
    expect(matchEventTriggers([sessionBinding], event, noAgentWaits)).toEqual([
      { binding: sessionBinding, tokens: { result: 'completed', chatId: 'chat-1' } },
    ]);
  });

  it('ignores a non-terminal chat.updated event (no reason)', () => {
    const event: DaemonEvent = { type: 'chat.updated', chat: makeChat('chat-1') };
    expect(matchEventTriggers([sessionBinding], event, noAgentWaits)).toEqual([]);
  });

  it('excludes chats registered as automation-owned agent waits, avoiding a double-fire', () => {
    const event: DaemonEvent = { type: 'chat.updated', chat: makeChat('chat-1'), reason: 'completed' };
    const matches = matchEventTriggers([sessionBinding], event, (chatId) => chatId === 'chat-1');
    expect(matches).toEqual([]);
  });

  it('fires automation.finished when the source automation succeeded', () => {
    const event: DaemonEvent = {
      type: 'automation.completed',
      automationId: 'auto-source',
      automationName: 'Source',
      runId: 'run-1',
      status: 'succeeded',
      result: 'done',
    };
    const matches = matchEventTriggers([finishedBinding, failedBinding], event, noAgentWaits);
    expect(matches).toEqual([{ binding: finishedBinding, tokens: { result: 'done' } }]);
  });

  it('fires automation.failed when the source automation failed', () => {
    const event: DaemonEvent = {
      type: 'automation.completed',
      automationId: 'auto-source',
      automationName: 'Source',
      runId: 'run-1',
      status: 'failed',
      result: 'boom',
    };
    const matches = matchEventTriggers([finishedBinding, failedBinding], event, noAgentWaits);
    expect(matches).toEqual([{ binding: failedBinding, tokens: { result: 'boom' } }]);
  });

  it('applies automationFilter so only a matching source automationId fires', () => {
    const matchingSource: DaemonEvent = {
      type: 'automation.completed',
      automationId: 'auto-source',
      automationName: 'Source',
      runId: 'run-1',
      status: 'succeeded',
      result: 'done',
    };
    const otherSource: DaemonEvent = { ...matchingSource, automationId: 'other-automation' };

    expect(matchEventTriggers([scopedFinishedBinding], matchingSource, noAgentWaits)).toEqual([
      { binding: scopedFinishedBinding, tokens: { result: 'done' } },
    ]);
    expect(matchEventTriggers([scopedFinishedBinding], otherSource, noAgentWaits)).toEqual([]);
  });

  it('ignores daemon events unrelated to session/automation completion', () => {
    const event: DaemonEvent = { type: 'chat.created', chat: makeChat('chat-1') };
    expect(matchEventTriggers([sessionBinding], event, noAgentWaits)).toEqual([]);
  });
});
