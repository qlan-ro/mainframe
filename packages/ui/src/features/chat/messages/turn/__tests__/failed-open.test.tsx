import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, assistant, bash, failed, user } from './fixtures';

const row = (id: string) => screen.getByTestId(`chat-row-${id}-toggle`);

beforeEach(() => useUiPrefs.setState({ finishedWork: 'open' }));

it('keeps six different failures closed after later successes and still counts all six', () => {
  const failures = Array.from({ length: 6 }, (_, i) => bash(`bad-${i}`, `check ${i}`, failed));
  render(
    <TurnFixture
      rootId="moved-on"
      messages={[user('Hi'), assistant([...failures, bash('one', 'ls'), bash('two', 'pwd')])]}
    />,
  );
  expect(screen.getByRole('button', { name: '6 failed: show the failed step' })).toBeVisible();
  for (const failure of failures) expect(row(failure.toolCallId)).toHaveAttribute('aria-expanded', 'false');
});

it('opens only the last of two consecutive failures', () => {
  const steps = [bash('first', 'ls', failed), bash('last', 'pwd', failed)];
  render(<TurnFixture rootId="two-failures" messages={[user('Hi'), assistant(steps)]} />);
  expect(row('first')).toHaveAttribute('aria-expanded', 'false');
  expect(row('last')).toHaveAttribute('aria-expanded', 'true');
});

it('preserves manual open and close choices when the live turn ends', () => {
  const steps = [bash('manual', 'ls', failed), bash('closed', 'pwd', failed), bash('last', 'git status', failed)];
  const messages = [user('Hi'), assistant(steps)];
  const view = render(<TurnFixture rootId="manual" messages={messages} isRunning />);
  expect(row('last')).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(row('manual'));
  fireEvent.click(row('last'));
  fireEvent.click(row('last'));
  view.rerender(<TurnFixture rootId="manual" messages={messages} isRunning={false} />);
  expect(row('manual')).toHaveAttribute('aria-expanded', 'true');
  expect(row('closed')).toHaveAttribute('aria-expanded', 'false');
  expect(row('last')).toHaveAttribute('aria-expanded', 'false');
});
