import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { currentStep, runningTasksLabel, workingLabel } from '../working-label';

function assistant(content: unknown[], running = true): ThreadMessage {
  return {
    id: 'a',
    role: 'assistant',
    createdAt: new Date(0),
    content,
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
  } as unknown as ThreadMessage;
}
const read = (id: string, result?: string) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: 'Read',
  args: { file_path: '/src/a.ts' },
  argsText: '{}',
  result,
});
const idle = { stopping: false, compacting: false, awaitingInput: false };

describe('currentStep', () => {
  it('names the running tool with the live activity wording', () => {
    expect(currentStep([assistant([read('r')])], new Set())).toBe('Reading /src/a.ts');
  });
  it('reports Thinking while the newest step is running reasoning', () => {
    expect(currentStep([assistant([read('r', 'done'), { type: 'reasoning', text: 'hmm' }])], new Set())).toBe(
      'Thinking',
    );
  });
  it('has no step for streaming text, a settled message, or a user message last', () => {
    expect(currentStep([assistant([read('r', 'done'), { type: 'text', text: 'Hi' }])], new Set())).toBeNull();
    expect(currentStep([assistant([read('r', 'done')], false)], new Set())).toBeNull();
    expect(currentStep([{ ...assistant([]), role: 'user' } as ThreadMessage], new Set())).toBeNull();
  });
  it('skips a tool that is waiting for approval', () => {
    expect(currentStep([assistant([read('r')])], new Set(['r']))).toBeNull();
  });
});

describe('workingLabel', () => {
  it('falls back to Working without a step', () => {
    expect(workingLabel(idle, null)).toEqual({ text: 'Working', tone: 'working' });
  });
  it('ranks stopping, then needed input, then compaction above the step', () => {
    expect(workingLabel({ stopping: true, compacting: true, awaitingInput: true }, 'Reading a.ts').text).toBe(
      'Stopping',
    );
    expect(workingLabel({ ...idle, compacting: true, awaitingInput: true }, 'Reading a.ts')).toEqual({
      text: 'Needs your input',
      tone: 'attention',
    });
    expect(workingLabel({ ...idle, compacting: true }, 'Reading a.ts').text).toBe('Compacting');
    expect(workingLabel(idle, 'Reading a.ts').text).toBe('Reading a.ts');
  });
});

it('pluralises the running-task count', () => {
  expect(runningTasksLabel(1)).toBe('1 running task');
  expect(runningTasksLabel(3)).toBe('3 running tasks');
});
