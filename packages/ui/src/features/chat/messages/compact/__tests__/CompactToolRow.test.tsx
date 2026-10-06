import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CompactFixture, fixtureMessage, fixtureTool } from './fixtures';
import * as rows from '../../../view-model/compact/build-compact-rows';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('supports keyboard disclosure with a stable accessible name and bounded detail area', async () => {
  const user = userEvent.setup();
  render(<CompactFixture rootId="keyboard" messages={[fixtureMessage([fixtureTool()])]} />);
  const toggle = screen.getByRole('button', { name: 'Read files' });
  act(() => toggle.focus());
  await user.keyboard('{Enter}');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const detail = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(detail.style.maxHeight).toBe('min(224px, 50cqh)');
  expect(detail).not.toHaveAttribute('data-text-part');
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
it('keeps failures muted with an explicit error icon and no mounted body', () => {
  render(<CompactFixture rootId="error-style" messages={[fixtureMessage([fixtureTool({ isError: true })])]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Read files' }));
  const toggle = screen.getByRole('button', { name: 'Failed to read /src/a.ts' });
  expect(toggle).toHaveClass('text-muted-foreground');
  expect(screen.getByLabelText('failed')).toHaveClass('text-destructive');
  expect(screen.queryByTestId('read-card-root')).toBeNull();
});
it('keeps known empty completion stopped while a missing terminal signal remains active', () => {
  render(
    <CompactFixture
      rootId="empty"
      messages={[
        fixtureMessage(
          [
            fixtureTool({ toolCallId: 'empty', result: '' }),
            fixtureTool({
              toolCallId: 'pending',
              result: undefined,
              providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
            }),
          ],
          'streaming',
          true,
        ),
      ]}
    />,
  );
  const toggle = screen.getByRole('button', { name: 'Reading /src/a.ts' });
  expect(toggle).toBeInTheDocument();
  expect(screen.getByLabelText('running')).toHaveClass('motion-reduce:animate-none');
  expect(screen.getAllByLabelText('running')).toHaveLength(1);
  fireEvent.click(toggle);
  expect(screen.getByText('Read /src/a.ts')).toBeInTheDocument();
});
it('ticks a supplied clock without rebuilding compact rows or changing disclosure', () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const build = vi.spyOn(rows, 'buildCompactRows');
  render(
    <CompactFixture
      rootId="isolated-clock"
      messages={[
        fixtureMessage(
          [
            fixtureTool({
              toolName: 'Bash',
              args: { command: 'echo hello' },
              result: 'partial',
              timing: { startedAt: 5000 },
              providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
            }),
          ],
          'clock',
          true,
        ),
      ]}
    />,
  );
  const toggle = screen.getByRole('button', { name: 'echo' });
  fireEvent.click(toggle);
  const detailToggle = screen.getAllByRole('button', { name: 'echo' })[1]!;
  fireEvent.click(detailToggle);
  const before = build.mock.calls.length;
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText('0:07')).toBeInTheDocument();
  expect(build).toHaveBeenCalledTimes(before);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveAccessibleName('echo');
});
