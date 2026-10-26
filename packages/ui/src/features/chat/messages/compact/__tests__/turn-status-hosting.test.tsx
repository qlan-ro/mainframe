import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture } from './turn-fixtures';
import { turnTool } from './turn-test-support';

const liveRead = () => ({
  ...turnTool(
    'live',
    { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } },
    { state: 'running' },
  ),
  status: { type: 'running' as const },
});
afterEach(() => useUiPrefs.getState().setTranscriptMode('verbose'));

it('lets a live activity group ending the turn host the status, with no separate row', async () => {
  useUiPrefs.getState().setTranscriptMode('compact');
  render(<TurnFixture rootId="hosted" messages={[liveRead()]} />);
  const header = (await screen.findByText('Reading /src/a.ts')).closest('[data-testid^="chat-compact-row-"]')!;
  expect(header.querySelector('[data-testid="chat-thread-running"]')).not.toBeNull();
  expect(screen.getAllByTestId('chat-thread-running')).toHaveLength(1);
  expect(screen.queryByTestId('chat-turn-status')).toBeNull();
});

it('hosts on a group whose members span messages, where the newest message holds no units of its own', async () => {
  useUiPrefs.getState().setTranscriptMode('compact');
  const read = turnTool(
    'read',
    { result: 'text', providerMetadata: { mainframe: { acpStatus: 'completed' } } },
    {
      state: 'running',
    },
  );
  const shell = {
    ...turnTool(
      'shell',
      {
        toolName: 'Bash',
        args: { command: 'pnpm test' },
        result: undefined,
        providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
      },
      { state: 'running' },
    ),
    status: { type: 'running' as const },
  };
  render(<TurnFixture rootId="spanning" messages={[read, shell]} />);
  const header = (await screen.findByText('Running tests')).closest('[data-testid^="chat-compact-row-"]')!;
  expect(header.querySelector('[data-testid="chat-thread-running"]')).not.toBeNull();
  expect(screen.queryByTestId('chat-turn-status')).toBeNull();
});
