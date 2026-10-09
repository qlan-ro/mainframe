import { describe, it, expect } from 'vitest';
import { isFullCard, toolKind } from '../tool-kind';

describe('isFullCard', () => {
  it('keeps the delegate card whole in compact mode — it holds a task chat and its gate', () => {
    expect(isFullCard('mcp__mainframe__delegate_task')).toBe(true);
    expect(toolKind('mcp__mainframe__delegate_task')).toBe('mcp');
  });

  it('leaves the other orchestration tools to the compact rows', () => {
    expect(isFullCard('mcp__mainframe__task_status')).toBe(false);
  });
});
