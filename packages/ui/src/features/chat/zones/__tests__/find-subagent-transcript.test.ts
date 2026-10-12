import type { ThreadMessage } from '@assistant-ui/react';
import { describe, expect, it } from 'vitest';
import { findSubagentTranscript } from '../find-subagent-transcript';

function thread(id: string, content: ThreadMessage['content']): ThreadMessage {
  return { id, role: 'assistant', content, status: { type: 'complete', reason: 'stop' } } as ThreadMessage;
}

describe('findSubagentTranscript', () => {
  it('selects the requested child when two task cards share a parent message', () => {
    const first = [thread('first-child', [{ type: 'text', text: 'first' }])];
    const second = [thread('second-child', [{ type: 'text', text: 'second' }])];
    const parent = [
      thread('parent', [
        { type: 'tool-call', toolCallId: 'first', toolName: 'Task', args: {}, argsText: '{}', messages: first },
        { type: 'tool-call', toolCallId: 'second', toolName: 'Task', args: {}, argsText: '{}', messages: second },
      ]),
    ];

    expect(findSubagentTranscript(parent, 'second')).toBe(second);
    expect(findSubagentTranscript(parent, 'missing')).toBeNull();
  });

  it('finds nested task cards and uses their latest streamed messages', () => {
    const grandchild = [thread('grandchild', [{ type: 'text', text: 'latest' }])];
    const child = [
      thread('child', [
        { type: 'tool-call', toolCallId: 'nested', toolName: 'Task', args: {}, argsText: '{}', messages: grandchild },
      ]),
    ];
    const parent = [
      thread('parent', [
        { type: 'tool-call', toolCallId: 'outer', toolName: 'Task', args: {}, argsText: '{}', messages: child },
      ]),
    ];

    expect(findSubagentTranscript(parent, 'nested')).toBe(grandchild);
  });
});
