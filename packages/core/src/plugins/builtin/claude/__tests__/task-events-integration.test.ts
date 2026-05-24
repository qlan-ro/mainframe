import { describe, it, expect, vi } from 'vitest';
import { handleStdout } from '../events.js';
import { ClaudeSession } from '../session.js';
import { BackgroundTaskTracker } from '../../../../background-tasks/tracker.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';

function makeSession(mainframeChatId: string) {
  const tracker = new BackgroundTaskTracker();
  const session = new ClaudeSession({ projectPath: '/tmp', mainframeChatId }, undefined, tracker);
  return { session, tracker };
}

function makeSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onCompactStart: vi.fn(),
    onContextUsage: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(),
    onTodoUpdate: vi.fn(),
    onPrDetected: vi.fn(),
    onCliMessage: vi.fn(),
    onSkillLoaded: vi.fn(),
    onSubagentChild: vi.fn(),
  };
}

function send(session: ClaudeSession, sink: SessionSink, event: unknown) {
  handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);
}

describe('task event chain — Mainframe chat id is used (not Claude session id)', () => {
  it('tracker.list(mainframeChatId) contains the task after task_started arrives', () => {
    const { session, tracker } = makeSession('mf-chat-42');
    const sink = makeSink();

    // 1. system:init sets state.chatId to the Claude session id
    send(session, sink, { type: 'system', subtype: 'init', session_id: 'claude-session-abc' });
    expect(session.state.chatId).toBe('claude-session-abc');
    expect(session.state.mainframeChatId).toBe('mf-chat-42');

    // 2. task_started should land in tracker keyed by mainframeChatId, not chatId
    send(session, sink, {
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-1',
      tool_use_id: 'tu-1',
      description: 'sleep 5',
    });

    expect(tracker.list('mf-chat-42')).toHaveLength(1);
    // Wrong key (Claude session id) must yield empty — this is the regression guard
    expect(tracker.list('claude-session-abc')).toEqual([]);
  });

  it('tracker.list(mainframeChatId) reflects completion after task_notification arrives', () => {
    const { session, tracker } = makeSession('mf-chat-99');
    const sink = makeSink();

    send(session, sink, { type: 'system', subtype: 'init', session_id: 'claude-session-xyz' });
    send(session, sink, {
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-2',
      tool_use_id: 'tu-2',
      description: 'build project',
    });
    send(session, sink, {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-2',
      status: 'completed',
      summary: 'Done',
    });

    const tasks = tracker.list('mf-chat-99');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('completed');
    // Wrong key must still yield empty
    expect(tracker.list('claude-session-xyz')).toEqual([]);
  });
});
