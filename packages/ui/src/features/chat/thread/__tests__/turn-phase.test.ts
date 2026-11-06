import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { runningTasksLabel, statusAnchorId, turnPhase } from '../turn-phase';

function message(role: string, content: unknown[] = [], extra: Record<string, unknown> = {}): ThreadMessage {
  return {
    id: `${role}-${content.length}`,
    role,
    content,
    status: { type: 'running' },
    metadata: { custom: {} },
    ...extra,
  } as unknown as ThreadMessage;
}
const idle = { stopping: false, compacting: false, awaitingInput: false };
const read = (result?: string) => ({
  type: 'tool-call',
  toolCallId: 'r',
  toolName: 'Read',
  args: {},
  argsText: '{}',
  result,
});

describe('turnPhase', () => {
  it('reports the stream phase of the newest sent message', () => {
    expect(turnPhase(idle, [message('user')], new Set())).toBe('Thinking');
    expect(turnPhase(idle, [message('assistant', [{ type: 'text', text: 'Hi' }])], new Set())).toBe('Writing');
    expect(turnPhase(idle, [message('assistant', [read()])], new Set())).toBe('Working');
    expect(turnPhase(idle, [message('assistant', [read('done')])], new Set())).toBe('Thinking');
    expect(turnPhase(idle, [message('assistant', [{ type: 'reasoning', text: 'hm' }])], new Set())).toBe('Thinking');
  });
  it('treats a tool waiting for approval as not working', () => {
    expect(turnPhase(idle, [message('assistant', [read()])], new Set(['r']))).toBe('Thinking');
  });
  it('ranks stopping, then needed input, then compaction above the stream phase', () => {
    const working = [message('assistant', [read()])];
    expect(turnPhase({ stopping: true, compacting: true, awaitingInput: true }, working, new Set())).toBe('Stopping');
    expect(turnPhase({ ...idle, compacting: true, awaitingInput: true }, working, new Set())).toBe('Needs your input');
    expect(turnPhase({ ...idle, compacting: true }, working, new Set())).toBe('Compacting');
  });
  it('ignores queued prompts when reading the phase', () => {
    const queued = message('user', [], { id: 'q', metadata: { custom: { mainframe: { queued: true } } } });
    expect(turnPhase(idle, [message('assistant', [{ type: 'text', text: 'Hi' }]), queued], new Set())).toBe('Writing');
  });
});

it('anchors on the newest message that is not a queued prompt', () => {
  const queued = (id: string) => message('user', [], { id, metadata: { custom: { mainframe: { queued: true } } } });
  expect(statusAnchorId([message('user', [], { id: 'u' }), queued('q1'), queued('q2')])).toBe('u');
  expect(statusAnchorId([queued('q1')])).toBeNull();
  expect(statusAnchorId([])).toBeNull();
});

it('pluralises the running-task count', () => {
  expect(runningTasksLabel(1)).toBe('1 running task');
  expect(runningTasksLabel(3)).toBe('3 running tasks');
});
