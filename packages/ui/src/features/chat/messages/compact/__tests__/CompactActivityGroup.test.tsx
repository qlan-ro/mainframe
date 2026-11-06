import type { MessagePartState } from '@assistant-ui/react';
import { ActivityFixture } from './activity-fixtures';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CompactFixture, fixtureMessage, fixtureTool } from './fixtures';

it('shows ordered tool summaries before mounting individual details and omits grouped reasoning', () => {
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
  const toggle = screen.getByRole('button', { name: /^Edited a file, read (a file|\d+ files), ran a command$/ });
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Compare the implementation')).toBeNull();
  expect(screen.queryByTestId('read-card-root')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.queryByTestId('read-card-code-preview')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Read /src/a.ts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edited /src/b.ts' }));
  fireEvent.click(screen.getByRole('button', { name: 'echo done' }));
  expect(screen.getByTestId('read-card-code-preview')).toHaveTextContent('const a = 1;');
  expect(screen.queryByText('Compare the implementation')).toBeNull();
  expect(screen.getByTestId('chat-edit-open-diff')).toBeInTheDocument();
  expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('shell detail');
});

it('keeps expanded members open through growth, reclassification and splitting', async () => {
  const read = fixtureTool();
  const readB = fixtureTool({ toolCallId: 'read-b', args: { file_path: '/src/b.ts' }, result: 'const b = 2;' });
  const shell = fixtureTool({ toolCallId: 'shell', toolName: 'Bash', args: { command: 'echo done' }, result: 'done' });
  const view = render(<CompactFixture rootId="activity-growth" messages={[fixtureMessage([read, readB])]} />);
  const toggle = screen.getByRole('button', { name: 'Read 2 files' });
  const identity = toggle.dataset.testid;
  fireEvent.click(toggle);
  view.rerender(<CompactFixture rootId="activity-growth" messages={[fixtureMessage([read, readB, shell])]} />);
  expect(await screen.findByRole('button', { name: 'Read 2 files, ran a command' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Read 2 files, ran a command' }).dataset.testid).toBe(identity);
  fireEvent.click(screen.getByRole('button', { name: 'echo done' }));
  expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('done');
  const failed = { ...read, isError: true };
  view.rerender(<CompactFixture rootId="activity-growth" messages={[fixtureMessage([failed, readB, shell])]} />);
  expect(await screen.findByRole('button', { name: 'Read 2 files (1 failed), ran a command' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Failed to read /src/a.ts' })).toBeVisible();
});
it('keeps pending tools standalone while ordinary failures and unknown tools stay grouped', () => {
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
  expect(screen.getByRole('button', { name: 'Read a file (1 failed)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Failed to read/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Waiting for approval/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Called a tool, read a file' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'CustomAnalytics' })).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(3);
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
  fireEvent.click(screen.getByRole('button', { name: 'Read 2 files' }));
  fireEvent.click(screen.getByRole('button', { name: 'Read /src/a.ts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Read /src/b.ts' }));
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
  const shell = fixtureTool({ toolCallId: 'shell', toolName: 'Bash', args: { command: 'echo done' }, result: 'done' });
  const messages = [fixtureMessage([fixtureTool(), shell])];
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
  const main = within(screen.getByTestId('main')).getByRole('button', { name: 'Read a file, ran a command' });
  const side = within(screen.getByTestId('side')).getByRole('button', { name: 'Read a file, ran a command' });
  fireEvent.click(main);
  expect(main).toHaveAttribute('aria-expanded', 'true');
  expect(side).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(side);
  fireEvent.click(within(screen.getByTestId('side')).getByRole('button', { name: 'Read /src/a.ts' }));
  expect(within(screen.getByTestId('side')).getByTestId('read-card-code-preview')).toHaveTextContent('const a = 1;');
});
it('shows a running member on the header, nested under it, even when the group is not the open tail', () => {
  const edit = fixtureTool({
    toolCallId: 'edit',
    toolName: 'Edit',
    args: { file_path: '/src/b.ts', old_string: 'old', new_string: 'new' },
    result: { originalFile: 'old', modifiedFile: 'new' },
  });
  const shell = fixtureTool({
    toolCallId: 'shell',
    toolName: 'Bash',
    args: { command: 'npm test', description: 'Run the suite' },
    result: undefined,
    providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
  });
  const message = fixtureMessage([edit, shell]);
  const members = message.content.map((part, index) => ({
    messageId: message.id,
    index,
    rootThreadId: 'running-member',
    ancestors: [],
    part: part as MessagePartState,
  }));
  const group = { type: 'activity' as const, members, active: false };
  const view = render(<ActivityFixture rootId="running-member" messages={[message]} group={group} />);
  const toggle = screen.getByRole('button', { name: 'Running tests' });
  expect(within(toggle).getByLabelText('running')).toBeInTheDocument();
  fireEvent.click(toggle);
  const nested = screen.getByTestId('chat-compact-activity-members');
  expect(within(nested).getByRole('button', { name: 'Edited /src/b.ts' })).toBeInTheDocument();
  expect(within(nested).getByRole('button', { name: 'Running tests' })).not.toBe(toggle);
  expect(nested).not.toContainElement(toggle);

  const done = { ...shell, result: 'ok', providerMetadata: { mainframe: { acpStatus: 'completed' } } };
  const settled = fixtureMessage([edit, done]);
  const settledMembers = members.map((member, index) => ({
    ...member,
    part: settled.content[index] as MessagePartState,
  }));
  view.rerender(
    <ActivityFixture
      rootId="running-member"
      messages={[settled]}
      group={{ type: 'activity', members: settledMembers, active: false }}
    />,
  );
  const summary = screen.getByRole('button', { name: 'Edited a file, ran a command' });
  expect(within(summary).queryByLabelText('completed')).toBeNull();
  expect(within(summary).queryByLabelText('running')).toBeNull();
});
