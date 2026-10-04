import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, finalMessage, turnMessage } from './turn-fixtures';
import { turnTool } from './turn-test-support';

beforeEach(() => useUiPrefs.getState().setTranscriptMode('compact'));

it('folds a recovered command failure and still permits manual opening and closing', () => {
  render(
    <TurnFixture
      rootId="parity-failure"
      messages={[
        turnMessage('work', 'Checking the build'),
        turnTool('failed', { toolName: 'Bash', args: { command: 'pnpm test' }, isError: true, result: 'failed' }),
        turnTool('recovered', { toolName: 'Bash', args: { command: 'pnpm test' }, result: 'passed' }),
        finalMessage(),
      ]}
    />,
  );
  const toggle = screen.getByRole('button', { name: 'Work details' });
  expect(toggle).toBeEnabled();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Checking the build')).toBeNull();
  expect(screen.getByText('Final answer')).toBeVisible();
  fireEvent.click(toggle);
  expect(screen.getByText('Checking the build')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ran commands' })).toBeVisible();
  fireEvent.click(toggle);
  expect(screen.queryByText('Checking the build')).toBeNull();
  expect(screen.getByText('Final answer')).toBeVisible();
});

it('folds denied actions after completion but keeps pending approval reachable', async () => {
  const denied = turnTool('denied', { approval: { id: 'approval', approved: false } });
  const view = render(<TurnFixture rootId="parity-denied" messages={[denied, finalMessage()]} />);
  const toggle = screen.getByRole('button', { name: 'Work details' });
  expect(toggle).toBeEnabled();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: /Declined/ })).toBeVisible();
  view.rerender(
    <TurnFixture
      rootId="parity-pending"
      pending={['pending']}
      messages={[
        turnTool('pending', { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } }),
        finalMessage(),
      ]}
    />,
  );
  expect(await screen.findByRole('button', { name: /Waiting for approval/ })).toBeVisible();
});

it('folds explicitly completed work without requiring a final-answer part', async () => {
  const view = render(
    <TurnFixture
      rootId="parity-completion"
      messages={[turnMessage('work', 'Intermediate progress', { state: 'running' })]}
    />,
  );
  expect(await screen.findByText('Intermediate progress')).toBeVisible();
  view.rerender(
    <TurnFixture
      rootId="parity-completion"
      messages={[turnMessage('work', 'Intermediate progress', { state: 'completed' })]}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false'),
  );
  expect(screen.queryByText('Intermediate progress')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Work details' }));
  expect(screen.getByText('Intermediate progress')).toBeVisible();
});

it('keeps separate provider turns independently folded with both final answers visible', () => {
  render(
    <TurnFixture
      rootId="parity-turns"
      messages={[
        turnMessage('work-one', 'First work', { turnId: 'first' }),
        turnMessage('final-one', 'First answer', { turnId: 'first', phase: 'final_answer', finalEligible: true }),
        turnMessage('work-two', 'Second work', { turnId: 'second' }),
        turnMessage('final-two', 'Second answer', { turnId: 'second', phase: 'final_answer', finalEligible: true }),
      ]}
    />,
  );
  const toggles = screen.getAllByRole('button', { name: 'Work details' });
  expect(toggles).toHaveLength(2);
  expect(screen.getByText('First answer')).toBeVisible();
  expect(screen.getByText('Second answer')).toBeVisible();
  fireEvent.click(toggles[0]!);
  expect(screen.getByText('First work')).toBeVisible();
  expect(screen.queryByText('Second work')).toBeNull();
});
