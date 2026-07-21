// packages/core/src/__tests__/todos-normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeTodos } from '../todos/normalize.js';

describe('normalizeTodos — invalid/empty input', () => {
  it.each([
    ['todoV1', null, []],
    ['todoV1', 'string', []],
    ['todoV1', {}, []],
    ['todoV1', [], []],
    ['taskV2', null, []],
    ['taskV2', [], []],
    ['codexTodoList', null, []],
    ['codexTodoList', {}, []],
    ['codexTodoList', [], []],
  ] as const)('normalizeTodos(%s, %j) → []', (variant, payload, expected) => {
    expect(normalizeTodos(variant, payload)).toEqual(expected);
  });
});

describe('normalizeTodos — todoV1', () => {
  it('returns valid TodoItems as-is', () => {
    const input = [
      { content: 'Write tests', status: 'pending', activeForm: 'Write tests' },
      { content: 'Fix bug', status: 'in_progress', activeForm: 'Fixing the bug' },
      { content: 'Ship it', status: 'completed', activeForm: 'Ship it' },
    ];
    expect(normalizeTodos('todoV1', input)).toEqual(input);
  });

  it('filters out items missing content or status', () => {
    const input = [
      { content: 'Valid', status: 'pending', activeForm: 'Valid' },
      { status: 'pending' }, // missing content
      { content: 'Also valid', status: 'completed', activeForm: '' },
    ];
    const result = normalizeTodos('todoV1', input);
    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe('Valid');
    expect(result[1]!.content).toBe('Also valid');
  });
});

describe('normalizeTodos — taskV2', () => {
  it.each([
    [
      [
        {
          toolName: 'TaskCreate' as const,
          args: { subject: 'Write tests', activeForm: 'Writing tests' },
          result: 'Task #1 created',
        },
      ],
      ['Write tests'],
    ],
    [
      [
        { toolName: 'TaskCreate' as const, args: { subject: 'Alpha' }, result: 'Task #1 created' },
        { toolName: 'TaskCreate' as const, args: { subject: 'Beta' }, result: 'Task #2 created' },
        { toolName: 'TaskCreate' as const, args: { subject: 'Gamma' }, result: 'Task #3 created' },
      ],
      ['Alpha', 'Beta', 'Gamma'],
    ],
  ] as const)('TaskCreate events map to pending todos in order', (events, expectedContents) => {
    const result = normalizeTodos('taskV2', events);
    expect(result).toHaveLength(expectedContents.length);
    expect(result.map((t) => t.content)).toEqual(expectedContents);
    expect(result.every((t) => t.status === 'pending')).toBe(true);
  });

  it.each([['in_progress'], ['completed']] as const)(
    'TaskUpdate changes status of an existing task to %s',
    (status) => {
      const events = [
        { toolName: 'TaskCreate' as const, args: { subject: 'Task A' }, result: 'Task #1 created' },
        { toolName: 'TaskUpdate' as const, args: { taskId: '1', status } },
      ];
      const result = normalizeTodos('taskV2', events);
      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe(status);
    },
  );

  it('TaskStop removes task from list', () => {
    const events = [
      { toolName: 'TaskCreate' as const, args: { subject: 'Task A' }, result: 'Task #1 created' },
      { toolName: 'TaskCreate' as const, args: { subject: 'Task B' }, result: 'Task #2 created' },
      { toolName: 'TaskStop' as const, args: { taskId: '1' } },
    ];
    const result = normalizeTodos('taskV2', events);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('Task B');
  });

  it('mid-task update preserves other tasks', () => {
    const events = [
      { toolName: 'TaskCreate' as const, args: { subject: 'Task 1' }, result: 'Task #1 created' },
      { toolName: 'TaskCreate' as const, args: { subject: 'Task 2' }, result: 'Task #2 created' },
      { toolName: 'TaskUpdate' as const, args: { taskId: '1', status: 'in_progress' } },
    ];
    const result = normalizeTodos('taskV2', events);
    expect(result).toHaveLength(2);
    expect(result[0]!.status).toBe('in_progress');
    expect(result[1]!.status).toBe('pending');
  });

  it('TaskUpdate for unknown taskId creates a new entry', () => {
    const events = [
      { toolName: 'TaskUpdate' as const, args: { taskId: '99', status: 'in_progress', subject: 'Mystery Task' } },
    ];
    const result = normalizeTodos('taskV2', events);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('Mystery Task');
    expect(result[0]!.status).toBe('in_progress');
  });
});

describe('normalizeTodos — codexTodoList', () => {
  it.each([
    [
      [
        { text: 'Write tests', completed: false },
        { text: 'Fix bug', completed: true },
      ],
      [
        { content: 'Write tests', status: 'pending', activeForm: 'Write tests' },
        { content: 'Fix bug', status: 'completed', activeForm: 'Fix bug' },
      ],
    ],
    [[{ text: 'My task', completed: false }], [{ content: 'My task', status: 'pending', activeForm: 'My task' }]],
  ] as const)('maps items to content/status/activeForm', (items, expected) => {
    expect(normalizeTodos('codexTodoList', items)).toEqual(expected);
  });

  it('filters out items without text field', () => {
    const items = [
      { text: 'Valid', completed: false },
      { completed: true }, // missing text
      { text: 'Also valid', completed: false },
    ];
    const result = normalizeTodos('codexTodoList', items);
    expect(result).toHaveLength(2);
  });

  it('all completed maps to all completed status', () => {
    const items = [
      { text: 'Done 1', completed: true },
      { text: 'Done 2', completed: true },
    ];
    const result = normalizeTodos('codexTodoList', items);
    expect(result.every((t) => t.status === 'completed')).toBe(true);
  });
});
