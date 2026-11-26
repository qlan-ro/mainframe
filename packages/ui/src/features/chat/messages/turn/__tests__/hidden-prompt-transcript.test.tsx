import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, assistant, bash, text, user } from './fixtures';

useUiPrefs.setState({ finishedWork: 'fold' });

it('keeps both answers visible across a hidden task notification while earlier work is folded', () => {
  render(
    <TurnFixture
      rootId="hidden-prompt-test"
      messages={[
        user('Check the project'),
        assistant([bash('checks', 'ls'), text('The detailed answer')], 'first', {
          custom: { turnGroup: 'p1' },
          timing: 4000,
        }),
        assistant([text('The later reply')], 'second', {
          custom: { turnGroup: 'p2', hiddenPromptEvent: 'Background task finished' },
          timing: 2000,
        }),
      ]}
    />,
  );
  expect(screen.getByRole('button', { name: /Worked for 4s/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('The detailed answer')).toBeVisible();
  expect(screen.getByText('Background task finished')).toBeVisible();
  expect(screen.getByText('Worked for 2s')).toBeVisible();
  expect(screen.getByText('The later reply')).toBeVisible();
});
