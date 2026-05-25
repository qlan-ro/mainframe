import { describe, it, expect, beforeEach } from 'vitest';
import { useBackgroundTasksStore } from '../background-tasks.js';
import type { BackgroundTask, BackgroundTaskStartedEvent, BackgroundTaskEndedEvent } from '@qlan-ro/mainframe-types';

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 't1',
    toolName: 'Bash',
    toolUseId: 'tu',
    command: 'x',
    description: '',
    outputPath: null,
    startedAt: 1,
    endedAt: null,
    status: 'running',
    lastOutputLine: null,
    summary: null,
    usage: null,
    ...overrides,
  };
}

describe('useBackgroundTasksStore', () => {
  beforeEach(() => {
    useBackgroundTasksStore.setState({ byChat: new Map() });
  });

  it('handles started events', () => {
    const event: BackgroundTaskStartedEvent = { type: 'background_task.started', chatId: 'c1', task: makeTask() };
    useBackgroundTasksStore.getState().applyEvent(event);
    expect(useBackgroundTasksStore.getState().listByChat('c1')).toHaveLength(1);
  });

  it('handles ended events (replaces existing record)', () => {
    useBackgroundTasksStore.getState().applyEvent({ type: 'background_task.started', chatId: 'c1', task: makeTask() });
    useBackgroundTasksStore.getState().applyEvent({
      type: 'background_task.ended',
      chatId: 'c1',
      task: makeTask({ status: 'completed', endedAt: 2, outputPath: '/tmp/x' }),
    } as BackgroundTaskEndedEvent);
    const list = useBackgroundTasksStore.getState().listByChat('c1');
    expect(list[0]!.status).toBe('completed');
    expect(list[0]!.outputPath).toBe('/tmp/x');
  });

  it('hydrate replaces the per-chat list', () => {
    useBackgroundTasksStore.getState().hydrate('c1', [makeTask({ id: 'a' }), makeTask({ id: 'b' })]);
    expect(
      useBackgroundTasksStore
        .getState()
        .listByChat('c1')
        .map((t) => t.id),
    ).toEqual(['a', 'b']);
  });

  it('runningCount counts running only', () => {
    useBackgroundTasksStore
      .getState()
      .hydrate('c1', [makeTask({ id: 'a', status: 'running' }), makeTask({ id: 'b', status: 'completed' })]);
    expect(useBackgroundTasksStore.getState().runningCount('c1')).toBe(1);
  });
});
