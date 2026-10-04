import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CompactFixture, fixtureMessage, fixtureTool } from './fixtures';

it('keeps the latest live activity visible through tool gaps without marking older messages active', async () => {
  const first = fixtureMessage([fixtureTool()], 'old');
  const command = fixtureTool({
    toolCallId: 'shell',
    toolName: 'Bash',
    args: { command: 'pnpm test', description: 'Verify the build' },
    result: undefined,
    providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
  });
  const view = render(
    <CompactFixture rootId="live-gaps" messages={[first, fixtureMessage([command], 'latest', true)]} />,
  );
  expect(await screen.findByText('Running tests')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Read files' })).toBeVisible();
  const completed = { ...command, result: 'passed', providerMetadata: { mainframe: { acpStatus: 'completed' } } };
  view.rerender(<CompactFixture rootId="live-gaps" messages={[first, fixtureMessage([completed], 'latest', true)]} />);
  expect(await screen.findByText('Thinking', {}, { timeout: 2000 })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Read files' })).toBeVisible();
  view.rerender(<CompactFixture rootId="live-gaps" messages={[first, fixtureMessage([completed], 'latest')]} />);
  expect(await screen.findByRole('button', { name: 'Ran a command' })).toBeVisible();
});

it('keeps live exploration visible without exposing unfinished details or grouped reasoning', async () => {
  const activeRead = fixtureTool({ result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } });
  const view = render(
    <CompactFixture
      rootId="unfinished-details"
      messages={[fixtureMessage([{ type: 'reasoning', text: 'Internal reasoning' }, activeRead], 'live', true)]}
    />,
  );
  expect(screen.getByText('Reading /src/a.ts')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Reading /src/a.ts' })).toBeNull();
  expect(screen.queryByTestId('read-card-root')).toBeNull();
  view.rerender(
    <CompactFixture
      rootId="unfinished-details"
      messages={[
        fixtureMessage(
          [
            fixtureTool({ toolCallId: 'done', args: { file_path: '/src/done.ts' } }),
            { type: 'reasoning', text: 'Internal reasoning' },
            activeRead,
          ],
          'live',
          true,
        ),
      ]}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Reading /src/a.ts' }));
  expect(screen.getByRole('button', { name: 'Read /src/done.ts' })).toBeVisible();
  expect(screen.queryByText('Internal reasoning')).toBeNull();
  expect(screen.queryByTestId('read-card-root')).toBeNull();
});
