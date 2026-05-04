// packages/core/src/__tests__/todos-normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeTodos } from '../todos/normalize.js';

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

  it('returns empty array for non-array payload', () => {
    expect(normalizeTodos('todoV1', null)).toEqual([]);
    expect(normalizeTodos('todoV1', 'string')).toEqual([]);
    expect(normalizeTodos('todoV1', {})).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeTodos('todoV1', [])).toEqual([]);
  });
});

describe('normalizeTodos — taskV2', () => {
  it('maps TaskCreate events to pending todos', () => {
    const events = [
      {
        toolName: 'TaskCreate' as const,
        args: { subject: 'Write tests', activeForm: 'Writing tests' },
        result: 'Task #1 created',
      },
    ];
    const result = normalizeTodos('taskV2', events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ content: 'Write tests', status: 'pending', activeForm: 'Writing tests' });
  });

  it('TaskUpdate changes status of existing task', () => {
    const events = [
      { toolName: 'TaskCreate' as const, args: { subject: 'Task A' }, result: 'Task #1 created' },
      { toolName: 'TaskUpdate' as const, args: { taskId: '1', status: 'in_progress' } },
    ];
    const result = normalizeTodos('taskV2', events);
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe('in_progress');
  });

  it('TaskUpdate marks task as completed', () => {
    const events = [
      { toolName: 'TaskCreate' as const, args: { subject: 'Task A' }, result: 'Task #1 created' },
      { toolName: 'TaskUpdate' as const, args: { taskId: '1', status: 'completed' } },
    ];
    const result = normalizeTodos('taskV2', events);
    expect(result[0]!.status).toBe('completed');
  });

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

  it('handles multiple TaskCreate events', () => {
    const events = [
      { toolName: 'TaskCreate' as const, args: { subject: 'Alpha' }, result: 'Task #1 created' },
      { toolName: 'TaskCreate' as const, args: { subject: 'Beta' }, result: 'Task #2 created' },
      { toolName: 'TaskCreate' as const, args: { subject: 'Gamma' }, result: 'Task #3 created' },
    ];
    const result = normalizeTodos('taskV2', events);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.content)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('returns empty array for empty event list', () => {
    expect(normalizeTodos('taskV2', [])).toEqual([]);
  });

  it('returns empty array for non-array payload', () => {
    expect(normalizeTodos('taskV2', null)).toEqual([]);
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
  it('maps items correctly to pending/completed', () => {
    const items = [
      { text: 'Write tests', completed: false },
      { text: 'Fix bug', completed: true },
    ];
    const result = normalizeTodos('codexTodoList', items);
    expect(result).toEqual([
      { content: 'Write tests', status: 'pending', activeForm: 'Write tests' },
      { content: 'Fix bug', status: 'completed', activeForm: 'Fix bug' },
    ]);
  });

  it('returns empty array for empty items', () => {
    expect(normalizeTodos('codexTodoList', [])).toEqual([]);
  });

  it('returns empty array for non-array payload', () => {
    expect(normalizeTodos('codexTodoList', null)).toEqual([]);
    expect(normalizeTodos('codexTodoList', {})).toEqual([]);
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

  it('activeForm matches content', () => {
    const items = [{ text: 'My task', completed: false }];
    const result = normalizeTodos('codexTodoList', items);
    expect(result[0]!.activeForm).toBe('My task');
  });
});
