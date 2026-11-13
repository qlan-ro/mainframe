import { describe, expect, it } from 'vitest';
import { delegatedTasksOf } from '@/features/sessions/view-model/agent-provenance';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { delegatedEntries } from '../activity-model';

function child(isRunning: boolean, hasPending = false): SessionItem {
  return {
    id: 'child',
    title: 'Design review',
    status: 'regular',
    custom: {
      projectId: 'project',
      adapterId: 'claude',
      tags: [],
      pinned: false,
      temporary: false,
      noProject: false,
      status: 'active',
      displayStatus: hasPending ? 'waiting' : isRunning ? 'working' : 'idle',
      isRunning,
      hasPending,
      detectedPrs: [],
      worktreeMissing: false,
      transcriptMissing: false,
      updatedAt: 2000,
      parentChatId: 'parent',
      delegation: { taskId: 'task_child', role: 'general', status: 'interrupted' },
    },
  };
}

describe('resumed child activity', () => {
  it('shows live child work without rewriting the interrupted task outcome', () => {
    const rows = delegatedTasksOf([child(true)], 'parent');
    expect(rows[0]?.status).toBe('interrupted');
    const entries = delegatedEntries(rows, []);
    expect(entries[0]?.state).toBe('running');
    expect(entries[0]?.detail).toContain('Resumed chat');
    expect(entries[0]?.detail).toContain('task interrupted');
    expect(entries[0]?.endedAt).toBeUndefined();
  });

  it('shows a resumed child waiting at a permission gate', () => {
    const entries = delegatedEntries(delegatedTasksOf([child(false, true)], 'parent'), []);
    expect(entries[0]?.state).toBe('waiting');
  });

  it('returns to the original outcome when the resumed turn ends', () => {
    const entries = delegatedEntries(delegatedTasksOf([child(false)], 'parent'), []);
    expect(entries[0]?.state).toBe('stopped');
    expect(entries[0]?.detail).not.toContain('Resumed chat');
  });

  it('does not put the parent-owned delegation in the child activity list', () => {
    expect(delegatedTasksOf([child(true)], 'child')).toEqual([]);
  });
});
