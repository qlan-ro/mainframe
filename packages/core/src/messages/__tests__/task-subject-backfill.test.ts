import { describe, it, expect } from 'vitest';
import type { DisplayMessage, DisplayContent, ChatMessage, ToolCategories } from '@qlan-ro/mainframe-types';
import { backfillTaskSubjects } from '../task-subject-backfill.js';
import { prepareMessagesForClient } from '../display-pipeline.js';

type ProgressItem = Extract<DisplayContent, { type: 'task_progress' }>['items'][number];

function createItem(id: string, subject: string): ProgressItem {
  return {
    id: `toolu_create_${id}`,
    name: 'TaskCreate',
    input: { subject },
    category: 'progress',
    result: { content: `Task #${id} created successfully: ${subject}`, isError: false },
  };
}

function updateItem(taskId: string, status: string, extraInput: Record<string, unknown> = {}): ProgressItem {
  return {
    id: `toolu_update_${taskId}_${status}`,
    name: 'TaskUpdate',
    input: { taskId, status, ...extraInput },
    category: 'progress',
    result: { content: `Updated task #${taskId} status`, isError: false },
  };
}

function assistantMsg(id: string, items: ProgressItem[]): DisplayMessage {
  return {
    id,
    chatId: 'chat-1',
    timestamp: '2026-07-04T00:00:00Z',
    type: 'assistant',
    content: [{ type: 'task_progress', items }],
  };
}

function progressItems(msg: DisplayMessage): ProgressItem[] {
  const block = msg.content.find((c) => c.type === 'task_progress');
  return block && block.type === 'task_progress' ? block.items : [];
}

describe('backfillTaskSubjects', () => {
  it("injects the TaskCreate subject into a later message's TaskUpdate items", () => {
    const messages = [
      assistantMsg('m1', [createItem('9', 'Task 3: silent reconcile'), createItem('10', 'Task 4: history unwrap')]),
      assistantMsg('m2', [updateItem('9', 'in_progress')]),
      assistantMsg('m3', [updateItem('9', 'completed'), updateItem('10', 'in_progress')]),
    ];
    const out = backfillTaskSubjects(messages);
    expect(progressItems(out[1]!)[0]!.input).toEqual({
      taskId: '9',
      status: 'in_progress',
      subject: 'Task 3: silent reconcile',
    });
    expect(progressItems(out[2]!)[0]!.input['subject']).toBe('Task 3: silent reconcile');
    expect(progressItems(out[2]!)[1]!.input['subject']).toBe('Task 4: history unwrap');
  });

  it('leaves a TaskUpdate that already carries a subject untouched and records the rename', () => {
    const messages = [
      assistantMsg('m1', [createItem('1', 'Old name')]),
      assistantMsg('m2', [updateItem('1', 'in_progress', { subject: 'New name' })]),
      assistantMsg('m3', [updateItem('1', 'completed')]),
    ];
    const out = backfillTaskSubjects(messages);
    expect(progressItems(out[1]!)[0]!.input['subject']).toBe('New name');
    // Later updates inherit the renamed subject, not the original.
    expect(progressItems(out[2]!)[0]!.input['subject']).toBe('New name');
  });

  it('leaves updates for unknown taskIds unchanged', () => {
    const messages = [assistantMsg('m1', [updateItem('42', 'completed')])];
    const out = backfillTaskSubjects(messages);
    expect(progressItems(out[0]!)[0]!.input).toEqual({ taskId: '42', status: 'completed' });
  });

  it('falls back to sequential ids when a TaskCreate has no result yet (streaming)', () => {
    const pending: ProgressItem = {
      id: 'toolu_create_pending',
      name: 'TaskCreate',
      input: { subject: 'Streaming task' },
      category: 'progress',
      // result not yet arrived
    };
    const messages = [assistantMsg('m1', [pending]), assistantMsg('m2', [updateItem('1', 'in_progress')])];
    const out = backfillTaskSubjects(messages);
    expect(progressItems(out[1]!)[0]!.input['subject']).toBe('Streaming task');
  });

  it('continues the sequential fallback after result-extracted ids', () => {
    const pending: ProgressItem = {
      id: 'toolu_create_pending2',
      name: 'TaskCreate',
      input: { subject: 'Sixth task' },
      category: 'progress',
    };
    const messages = [
      assistantMsg('m1', [createItem('5', 'Fifth task'), pending]), // pending should get id 6
      assistantMsg('m2', [updateItem('6', 'completed')]),
    ];
    const out = backfillTaskSubjects(messages);
    expect(progressItems(out[1]!)[0]!.input['subject']).toBe('Sixth task');
  });

  it('scopes subagent task_progress (nested in task_group) separately from the main thread', () => {
    const nested: DisplayContent = {
      type: 'task_group',
      agentId: 'agent-1',
      taskArgs: {},
      calls: [{ type: 'task_progress', items: [createItem('1', 'Subagent task'), updateItem('1', 'completed')] }],
    };
    const messages: DisplayMessage[] = [
      assistantMsg('m1', [createItem('1', 'Main task')]),
      {
        id: 'm2',
        chatId: 'chat-1',
        timestamp: '2026-07-04T00:00:01Z',
        type: 'assistant',
        content: [nested, { type: 'task_progress', items: [updateItem('1', 'in_progress')] }],
      },
    ];
    const out = backfillTaskSubjects(messages);
    const group = out[1]!.content.find((c) => c.type === 'task_group');
    if (group?.type !== 'task_group') throw new Error('missing task_group');
    const nestedProgress = group.calls.find((c) => c.type === 'task_progress');
    if (nestedProgress?.type !== 'task_progress') throw new Error('missing nested task_progress');
    // Subagent's update #1 resolves to the SUBAGENT's create, not the main thread's.
    expect(nestedProgress.items[1]!.input['subject']).toBe('Subagent task');
    // Main thread's update #1 resolves to the main create.
    expect(progressItems(out[1]!)[0]!.input['subject']).toBe('Main task');
  });

  it('does not mutate the input messages', () => {
    const messages = [
      assistantMsg('m1', [createItem('1', 'A task')]),
      assistantMsg('m2', [updateItem('1', 'completed')]),
    ];
    const snapshot = JSON.parse(JSON.stringify(messages));
    backfillTaskSubjects(messages);
    expect(messages).toEqual(snapshot);
  });

  it('coerces a numeric taskId on TaskUpdate.input to match the string-keyed create', () => {
    const numericUpdate: ProgressItem = {
      id: 'toolu_update_3_numeric',
      name: 'TaskUpdate',
      input: { taskId: 3, status: 'completed' },
      category: 'progress',
      result: { content: 'Updated task #3 status', isError: false },
    };
    const messages = [
      assistantMsg('m1', [createItem('3', 'Numeric taskId task')]),
      assistantMsg('m2', [numericUpdate]),
    ];
    const out = backfillTaskSubjects(messages);
    expect(progressItems(out[1]!)[0]!.input['subject']).toBe('Numeric taskId task');
  });

  it('passes non-assistant and non-task messages through untouched', () => {
    const user: DisplayMessage = {
      id: 'u1',
      chatId: 'chat-1',
      timestamp: '2026-07-04T00:00:00Z',
      type: 'user',
      content: [{ type: 'text', text: 'hello' }],
    };
    const out = backfillTaskSubjects([user]);
    expect(out[0]).toBe(user);
  });
});

describe('prepareMessagesForClient — task subject backfill integration', () => {
  const categories: ToolCategories = {
    explore: new Set(),
    hidden: new Set(['TaskCreate', 'TaskUpdate']),
    progress: new Set(['TaskCreate', 'TaskUpdate']),
    subagent: new Set(['Task']),
  };

  it('names an update-only turn from a create in a previous turn', () => {
    const messages: ChatMessage[] = [
      {
        id: 'a1',
        chatId: 'chat-1',
        type: 'assistant',
        timestamp: '2026-07-04T00:00:00Z',
        content: [
          { type: 'tool_use', id: 'toolu_c9', name: 'TaskCreate', input: { subject: 'Task 3: silent reconcile' } },
        ],
      },
      {
        id: 'u1',
        chatId: 'chat-1',
        type: 'tool_result',
        timestamp: '2026-07-04T00:00:01Z',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'toolu_c9',
            content: 'Task #9 created successfully: Task 3: silent reconcile',
            isError: false,
          },
        ],
      },
      // Real user text creates a grouping boundary → the update lands in a separate display message.
      {
        id: 'u2',
        chatId: 'chat-1',
        type: 'user',
        timestamp: '2026-07-04T00:00:02Z',
        content: [{ type: 'text', text: 'go on' }],
      },
      {
        id: 'a2',
        chatId: 'chat-1',
        type: 'assistant',
        timestamp: '2026-07-04T00:00:03Z',
        content: [
          { type: 'tool_use', id: 'toolu_u9', name: 'TaskUpdate', input: { taskId: '9', status: 'completed' } },
        ],
      },
    ];

    const display = prepareMessagesForClient(messages, categories);
    const updateMsg = display.find(
      (m) =>
        m.type === 'assistant' &&
        m.content.some((c) => c.type === 'task_progress' && c.items.some((i) => i.name === 'TaskUpdate')),
    );
    expect(updateMsg).toBeDefined();
    const block = updateMsg!.content.find((c) => c.type === 'task_progress');
    if (block?.type !== 'task_progress') throw new Error('missing task_progress');
    expect(block.items[0]!.input['subject']).toBe('Task 3: silent reconcile');
  });
});
