import { describe, it, expect } from 'vitest';
import { parseDelegateResult } from '../delegate-result';

describe('parseDelegateResult', () => {
  it('reads the TaskResult the MCP server returns as text', () => {
    const text = JSON.stringify({
      taskId: 'task_c1',
      childChatId: 'c1',
      title: 'Task: Review',
      status: 'running',
      summary: null,
    });
    expect(parseDelegateResult(text)).toEqual({
      taskId: 'task_c1',
      childChatId: 'c1',
      title: 'Task: Review',
      status: 'running',
    });
  });

  it('tolerates prose around the object and drops an unknown status', () => {
    const text = 'Result:\n{"taskId":"t","childChatId":"c","status":"bogus"}\n';
    expect(parseDelegateResult(text)).toEqual({ taskId: 't', childChatId: 'c', title: undefined, status: undefined });
  });

  it('returns null for an error text or an object without the ids', () => {
    expect(parseDelegateResult('Mutating tools may only be called during the caller’s active turn.')).toBeNull();
    expect(parseDelegateResult('{"taskId":"t"}')).toBeNull();
    expect(parseDelegateResult('{not json}')).toBeNull();
  });
});
