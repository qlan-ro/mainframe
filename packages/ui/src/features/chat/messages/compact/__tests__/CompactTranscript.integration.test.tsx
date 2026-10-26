import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { AssistantMessage } from '../../AssistantMessage';
import { disclosureKey } from '../disclosure-store';
import { CompactFixture, fixtureMessage, fixtureTool } from './fixtures';
import { TurnFixture, finalMessage } from './turn-fixtures';

vi.mock('../../AssistantForkAction', () => ({
  AssistantForkAction: () => <button data-testid="chat-assistant-message-fork" />,
}));

beforeEach(() => useUiPrefs.getState().setTranscriptMode('compact'));

it.each(['compact', 'verbose'] as const)('places Fork with Copy and Export on a completed %s turn', (mode) => {
  useUiPrefs.getState().setTranscriptMode(mode);
  render(<TurnFixture rootId="fork-actions" messages={[finalMessage()]} />);
  const footer = screen.getByTestId('chat-assistant-message').querySelector('[data-slot="message-footer"]');
  expect(footer).not.toBeNull();
  const copy = within(footer as HTMLElement).getByTestId('chat-message-copy');
  expect(copy).toBeInTheDocument();
  expect(within(footer as HTMLElement).getByTestId('chat-message-more')).toBeInTheDocument();
  expect(within(footer as HTMLElement).getByTestId('chat-assistant-message-fork').parentElement).toBe(
    copy.parentElement,
  );
});

it('does not show assistant actions on an in-progress compact turn', () => {
  render(<TurnFixture rootId="running-actions" messages={[finalMessage({ state: 'running' })]} />);
  expect(screen.queryByTestId('chat-message-copy')).toBeNull();
  expect(screen.queryByTestId('chat-assistant-message-fork')).toBeNull();
});

it('preserves an opened call through splitting, merging and remounting', async () => {
  const read = (id: string, file: string) => fixtureTool({ toolCallId: id, args: { file_path: file } });
  const [a, b, c, d] = [
    read('read-a', '/src/a.ts'),
    read('read-b', '/src/b.ts'),
    read('read-c', '/src/c.ts'),
    read('read-d', '/src/d.ts'),
  ];
  const initial = [fixtureMessage([a, b, { type: 'text', text: 'Between' }, c, d])];
  const thirdId = `chat-compact-toggle-${encodeURIComponent(disclosureKey('regroup', [], 'message', 'tool:read-c'))}`;
  const view = render(<CompactFixture rootId="regroup" messages={initial} />);
  fireEvent.click(screen.getByTestId(thirdId));
  view.rerender(<CompactFixture rootId="regroup" messages={[fixtureMessage([a, b, c, d])]} />);
  expect(await screen.findByRole('button', { name: 'Read 4 files' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Read 4 files' }));
  view.rerender(<CompactFixture rootId="regroup" messages={initial} />);
  expect(await screen.findByTestId(thirdId)).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByTestId(thirdId));
  view.unmount();
  render(<CompactFixture rootId="regroup" messages={initial} />);
  expect(await screen.findByTestId(thirdId)).toHaveAttribute('aria-expanded', 'true');
});

it('switches an active turn through Verbose and back without losing compact disclosure', async () => {
  const messages = [
    fixtureMessage(
      [
        fixtureTool({
          toolName: 'Bash',
          args: { command: 'npm test' },
          result: 'partial output',
          providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
        }),
      ],
      'active',
      true,
    ),
  ];
  render(<CompactFixture rootId="mode-switch" messages={messages} Message={AssistantMessage} />);
  const toggle = await screen.findByRole('button', { name: 'Running tests' });
  fireEvent.click(toggle);
  fireEvent.click(screen.getAllByRole('button', { name: 'Running tests' })[1]!);
  expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('partial output');
  act(() => useUiPrefs.getState().setTranscriptMode('verbose'));
  expect(screen.getByTestId('chat-bash-card')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Running tests' })).toBeNull();
  act(() => useUiPrefs.getState().setTranscriptMode('compact'));
  expect(screen.getAllByRole('button', { name: 'Running tests' })).toHaveLength(2);
  screen
    .getAllByRole('button', { name: 'Running tests' })
    .forEach((button) => expect(button).toHaveAttribute('aria-expanded', 'true'));
  expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('partial output');
});

it('opens nested transcripts directly and isolates identical call IDs in root and sibling agents', async () => {
  const child = fixtureMessage([fixtureTool()], 'same-message');
  const agent = (id: string) =>
    fixtureTool({ toolCallId: id, toolName: 'Task', args: { subagent_type: id }, messages: [child] });
  render(
    <CompactFixture
      rootId="nested"
      messages={[fixtureMessage([fixtureTool(), agent('alpha'), agent('beta')], 'same-message')]}
      Message={AssistantMessage}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Read /src/a.ts' }));
  const agentButtons = screen
    .getAllByRole('button')
    .filter((button) => /alpha|beta/.test(button.getAttribute('aria-label') ?? ''));
  expect(agentButtons).toHaveLength(2);
  agentButtons.forEach((button) => fireEvent.click(button));
  expect(screen.queryByTestId('chat-task-toggle')).toBeNull();
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Read /src/a.ts' })).toHaveLength(3));
  const reads = screen.getAllByRole('button', { name: 'Read /src/a.ts' });
  expect(reads.map((button) => button.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false']);
  fireEvent.click(reads[1]!);
  expect(reads[2]).toHaveAttribute('aria-expanded', 'false');
  expect(new Set(reads.map((button) => button.dataset.testid)).size).toBe(3);
});

it('keeps equal call IDs independent in main and side roots', () => {
  const messages = [fixtureMessage([fixtureTool()])];
  render(
    <>
      <div data-testid="main">
        <CompactFixture rootId="main-scope" messages={messages} />
      </div>
      <div data-testid="side">
        <CompactFixture rootId="side-scope" messages={messages} />
      </div>
    </>,
  );
  const main = within(screen.getByTestId('main')).getByRole('button', { name: 'Read /src/a.ts' });
  const side = within(screen.getByTestId('side')).getByRole('button', { name: 'Read /src/a.ts' });
  fireEvent.click(main);
  expect(main).toHaveAttribute('aria-expanded', 'true');
  expect(side).toHaveAttribute('aria-expanded', 'false');
});

it('retains the assistant error branch in both transcript modes', () => {
  const message = fixtureMessage([{ type: 'text', text: 'hidden normal text' }]);
  const error = {
    ...message,
    metadata: { ...message.metadata, custom: { mainframe: { errorText: 'Provider disconnected' } } },
  };
  render(<CompactFixture rootId="error" messages={[error]} Message={AssistantMessage} />);
  expect(screen.getByText('Provider disconnected')).toBeInTheDocument();
  expect(screen.queryByText('hidden normal text')).toBeNull();
  act(() => useUiPrefs.getState().setTranscriptMode('verbose'));
  expect(screen.getByText('Provider disconnected')).toBeInTheDocument();
});
