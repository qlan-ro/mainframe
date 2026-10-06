import { describe, it, expect } from 'vitest';
import { parseAgentMessage, parseAgentText, parseTaskResults } from '../agent-message';

const AGENT = '<mainframe-agent-message from="chat_1" kind="send">\nReview the diff\n</mainframe-agent-message>';
const RESULT_A =
  '<mainframe-task-result task="task_a" chat="child_a" status="completed">\nAll good\n</mainframe-task-result>';
const RESULT_B = '<mainframe-task-result task="task_b" chat="child_b" status="failed">\nBoom\n</mainframe-task-result>';

describe('parseAgentMessage', () => {
  it('reads the sender, the kind, and the body', () => {
    expect(parseAgentMessage(AGENT)).toEqual({ fromChatId: 'chat_1', kind: 'send', body: 'Review the diff' });
  });

  it('ignores plain text, an unknown kind, and trailing prose', () => {
    expect(parseAgentMessage('hello')).toBeNull();
    expect(parseAgentMessage(AGENT.replace('kind="send"', 'kind="other"'))).toBeNull();
    expect(parseAgentMessage(`${AGENT}\nand more`)).toBeNull();
  });
});

describe('parseTaskResults', () => {
  it('reads every batched result in order', () => {
    expect(parseTaskResults(`${RESULT_A}\n\n${RESULT_B}`)).toEqual([
      { taskId: 'task_a', chatId: 'child_a', status: 'completed', body: 'All good' },
      { taskId: 'task_b', chatId: 'child_b', status: 'failed', body: 'Boom' },
    ]);
  });

  it('rejects a message that is not made only of results', () => {
    expect(parseTaskResults(`${RESULT_A}\nalso this`)).toBeNull();
    expect(parseTaskResults('plain')).toBeNull();
  });
});

describe('parseAgentText', () => {
  it('routes each form', () => {
    expect(parseAgentText(AGENT)?.type).toBe('agent-message');
    expect(parseAgentText(RESULT_A)?.type).toBe('task-results');
    expect(parseAgentText('just me')).toBeNull();
  });
});
