import { describe, it, expect } from 'vitest';
import { taskResultText, extractTaskId } from '../task-progress.js';

describe('taskResultText', () => {
  it('returns a bare string result as-is', () => {
    expect(taskResultText('Task #9 created successfully: Ship it')).toBe('Task #9 created successfully: Ship it');
  });

  it('reads the content field of a ToolCallResult-shaped object', () => {
    expect(taskResultText({ content: 'Task #9 created successfully: Ship it', isError: false })).toBe(
      'Task #9 created successfully: Ship it',
    );
  });

  it('returns an empty string when the object has no content key', () => {
    expect(taskResultText({ isError: false })).toBe('');
  });

  it('returns an empty string for a non-object, non-string result', () => {
    expect(taskResultText(undefined)).toBe('');
    expect(taskResultText(42)).toBe('');
    expect(taskResultText(null)).toBe('');
  });
});

describe('extractTaskId', () => {
  it('extracts the numeric id from a TaskCreate result', () => {
    expect(extractTaskId('Task #9 created successfully: Ship it')).toBe('9');
  });

  it('extracts the id from a ToolCallResult-shaped object', () => {
    expect(extractTaskId({ content: 'Task #10 created successfully: Ship it', isError: false })).toBe('10');
  });

  it('returns undefined when the result has no task id', () => {
    expect(extractTaskId(undefined)).toBeUndefined();
    expect(extractTaskId({ content: 'no id here', isError: false })).toBeUndefined();
  });
});
