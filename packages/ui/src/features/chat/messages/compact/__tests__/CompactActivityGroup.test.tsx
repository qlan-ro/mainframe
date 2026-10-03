import type { MessagePartState } from '@assistant-ui/react';
import { ActivityFixture } from './activity-fixtures';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CompactFixture, fixtureMessage, fixtureTool } from './fixtures';

it('collapses mixed routine work and reasoning into one ordered native disclosure', () => {
  render(
    <CompactFixture
      rootId="mixed-activity"
      messages={[
        fixtureMessage([
          fixtureTool(),
          { type: 'reasoning', text: 'Compare the implementation' },
          fixtureTool({
            toolCallId: 'edit',
            toolName: 'Edit',
            args: { file_path: '/src/b.ts', old_string: 'old', new_string: 'new' },
            result: { originalFile: 'old', modifiedFile: 'new' },
          }),
          fixtureTool({
            toolCallId: 'shell',
            toolName: 'Bash',
            args: { command: 'echo done' },
            result: 'shell detail',
          }),
        ]),
      ]}
    />,
  );
  const toggle = screen.getByRole('button', { name: 'Edited a file, read files, ran a command' });
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Compare the implementation')).toBeNull();
  expect(screen.queryByTestId('read-card-root')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByTestId('read-card-code-preview')).toHaveTextContent('const a = 1;');
  expect(screen.getByText('Compare the implementation')).toBeInTheDocument();
  expect(screen.getByTestId('chat-edit-open-diff')).toBeInTheDocument();
  expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('shell detail');
});

it('keeps expanded members open through growth, reclassification and splitting', async () => {
  const read = fixtureTool();
  const shell = fixtureTool({ toolCallId: 'shell', toolName: 'Bash', args: { command: 'echo done' }, result: 'done' });
  const view = render(<CompactFixture rootId="activity-growth" messages={[fixtureMessage([read])]} />);
  const toggle = screen.getByRole('button', { name: 'Read files' });
  const identity = toggle.dataset.testid;
  fireEvent.click(toggle);
  view.rerender(<CompactFixture rootId="activity-growth" messages={[fixtureMessage([read, shell])]} />);
  expect(await screen.findByRole('button', { name: 'Read files, ran a command' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Read files, ran a command' }).dataset.testid).toBe(identity);
  expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('done');
  const failed = { ...read, isError: true };
  view.rerender(<CompactFixture rootId="activity-growth" messages={[fixtureMessage([failed, shell])]} />);
  expect(await screen.findByRole('button', { name: /Failed to read/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Ran a command' })).toHaveAttribute('aria-expanded', 'false');
});
it('keeps failed, pending and unknown tools visible outside the routine disclosure', () => {
  render(
    <CompactFixture
      rootId="activity-controls"
      pendingToolIds={['pending']}
      messages={[
        fixtureMessage([
          fixtureTool(),
          fixtureTool({ toolCallId: 'failed', isError: true }),
          fixtureTool({
            toolCallId: 'pending',
            result: undefined,
            providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
          }),
          fixtureTool({ toolCallId: 'dynamic', toolName: 'CustomAnalytics' }),
          fixtureTool({ toolCallId: 'last' }),
        ]),
      ]}
    />,
  );
  expect(screen.getAllByRole('button', { name: 'Read files' })).toHaveLength(2);
  expect(screen.getByRole('button', { name: /Failed to read/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Waiting for approval/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ran CustomAnalytics' })).toBeInTheDocument();
  expect(screen.queryByTestId('read-card-root')).toBeNull();
});
it.each([false, true])('renders cross-message references through their original native scopes (split=%s)', (split) => {
  const first = fixtureMessage([fixtureTool({ toolCallId: 'a', result: 'FIRST SOURCE' })], 'first');
  const second = fixtureMessage(
    [
      { type: 'text', text: 'not in this group' },
      fixtureTool({ toolCallId: 'b', result: 'SECOND SOURCE', args: { file_path: '/src/b.ts' } }),
    ],
    'second',
  );
  const members = [first, second].map((message, index) => ({
    messageId: message.id,
    index,
    rootThreadId: `cross-${split}`,
    ancestors: [],
    part: { ...message.content[index]!, status: { type: 'complete' as const } } as MessagePartState,
  }));
  render(
    <ActivityFixture
      rootId={`cross-${split}`}
      split={split}
      messages={[first, second]}
      group={{ type: 'activity', members, active: false }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Read files' }));
  expect(screen.getAllByTestId('read-card-code-preview').map((node) => node.textContent)).toEqual([
    'FIRST SOURCE',
    'SECOND SOURCE',
  ]);
  expect(screen.getAllByTestId('tool-card-file-path').map((node) => node.getAttribute('data-file-path'))).toEqual([
    '/src/a.ts',
    '/src/b.ts',
  ]);
  expect(screen.queryByText('not in this group')).toBeNull();
});
it('keeps main and real split native disclosures independent with identical message and call IDs', () => {
  const messages = [fixtureMessage([fixtureTool()])];
  render(
    <>
      <div data-testid="main">
        <ActivityFixture rootId="group-main" messages={messages} />
      </div>
      <div data-testid="side">
        <ActivityFixture rootId="group-side" messages={messages} split />
      </div>
    </>,
  );
  const main = within(screen.getByTestId('main')).getByRole('button', { name: 'Read files' });
  const side = within(screen.getByTestId('side')).getByRole('button', { name: 'Read files' });
  fireEvent.click(main);
  expect(main).toHaveAttribute('aria-expanded', 'true');
  expect(side).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(side);
  expect(within(screen.getByTestId('side')).getByTestId('read-card-code-preview')).toHaveTextContent('const a = 1;');
});
