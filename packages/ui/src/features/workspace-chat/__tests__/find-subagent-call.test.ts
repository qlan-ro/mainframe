import type { ThreadMessage } from '@assistant-ui/react';
import { describe, expect, it } from 'vitest';
import { findSubagentCall, toolCallIdsOf } from '../find-subagent-call';

function message(id: string, ...calls: { id: string; messages?: ThreadMessage[] }[]): ThreadMessage {
  return {
    id,
    role: 'assistant',
    content: [
      { type: 'text', text: 'hello' },
      ...calls.map((call) => ({ type: 'tool-call', toolCallId: call.id, messages: call.messages })),
    ],
  } as unknown as ThreadMessage;
}

const inner = message('inner', { id: 'bash-1' }, { id: 'agent-2', messages: [message('deep', { id: 'bash-2' })] });
const transcript = [message('m-1', { id: 'read-1' }), message('m-2', { id: 'agent-1', messages: [inner] })];

describe('findSubagentCall', () => {
  it('finds a top-level agent in its message', () => {
    expect(findSubagentCall(transcript, 'agent-1')).toMatchObject({
      messageId: 'm-2',
      part: { toolCallId: 'agent-1' },
    });
  });

  it('finds an agent started by an agent, in the top-level message that holds both', () => {
    expect(findSubagentCall(transcript, 'agent-2')).toMatchObject({
      messageId: 'm-2',
      part: { toolCallId: 'agent-2' },
    });
  });

  it('finds nothing that is not there', () => {
    expect(findSubagentCall(transcript, 'agent-9')).toBeNull();
  });
});

it('lists the calls an agent made, at any depth', () => {
  expect(toolCallIdsOf([inner])).toEqual(['bash-1', 'agent-2', 'bash-2']);
});
