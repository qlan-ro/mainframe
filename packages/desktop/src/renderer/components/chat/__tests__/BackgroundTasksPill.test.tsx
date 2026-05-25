import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BackgroundTasksPill } from '../BackgroundTasksPill.js';
import { useBackgroundTasksStore } from '../../../store/background-tasks.js';

beforeEach(() => {
  useBackgroundTasksStore.setState({ byChat: new Map() });
});

describe('BackgroundTasksPill', () => {
  it('renders nothing when no tracked tasks at all', () => {
    const { container } = render(<BackgroundTasksPill chatId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders pill with running count when running tasks exist', () => {
    act(() => {
      useBackgroundTasksStore.getState().hydrate('c1', [
        {
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
        },
      ]);
    });
    render(<BackgroundTasksPill chatId="c1" />);
    expect(screen.getByTestId('chat-session-bar-bg-tasks-pill')).toBeTruthy();
    expect(screen.getByTestId('chat-session-bar-bg-tasks-pill').textContent).toContain('1');
  });

  it('disappears after only task completes', () => {
    act(() => {
      useBackgroundTasksStore.getState().hydrate('c1', [
        {
          id: 't1',
          toolName: 'Bash',
          toolUseId: 'tu',
          command: 'x',
          description: '',
          outputPath: '/tmp/claude-501/p/s/tasks/t1.output',
          startedAt: 1,
          endedAt: 2,
          status: 'completed',
          lastOutputLine: null,
          summary: null,
          usage: null,
        },
      ]);
    });
    const { container } = render(<BackgroundTasksPill chatId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  it('hides when the only tracked task is killed without output (nothing to view)', () => {
    act(() => {
      useBackgroundTasksStore.getState().hydrate('c1', [
        {
          id: 't1',
          toolName: 'Bash',
          toolUseId: 'tu',
          command: 'x',
          description: '',
          outputPath: null,
          startedAt: 1,
          endedAt: 2,
          status: 'stopped',
          lastOutputLine: null,
          summary: null,
          usage: null,
        },
      ]);
    });
    const { container } = render(<BackgroundTasksPill chatId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  it('singular vs plural label for running tasks', () => {
    act(() => {
      useBackgroundTasksStore.getState().hydrate('c1', [
        {
          id: 'a',
          toolName: 'Bash',
          toolUseId: '',
          command: '',
          description: '',
          outputPath: null,
          startedAt: 1,
          endedAt: null,
          status: 'running',
          lastOutputLine: null,
          summary: null,
          usage: null,
        },
        {
          id: 'b',
          toolName: 'Bash',
          toolUseId: '',
          command: '',
          description: '',
          outputPath: null,
          startedAt: 1,
          endedAt: null,
          status: 'running',
          lastOutputLine: null,
          summary: null,
          usage: null,
        },
      ]);
    });
    render(<BackgroundTasksPill chatId="c1" />);
    expect(screen.getByTestId('chat-session-bar-bg-tasks-pill').textContent).toContain('2 tasks');
  });
});
