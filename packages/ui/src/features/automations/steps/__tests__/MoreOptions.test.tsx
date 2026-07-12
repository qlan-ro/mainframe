/**
 * MoreOptions — disclosure wrapper for the rare knobs each step config folds
 * under (ts153 wf2-stepconfig.jsx `WfMore`). TDD: test written first,
 * implemented after.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoreOptions } from '../MoreOptions';

describe('MoreOptions', () => {
  it('hides its children until toggled open, then shows them', async () => {
    const user = userEvent.setup();
    render(
      <MoreOptions testId="automations-more-a">
        <span>Hidden content</span>
      </MoreOptions>,
    );
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('automations-more-a'));
    expect(screen.getByText('Hidden content')).toBeInTheDocument();
  });

  it('toggles closed again on a second click', async () => {
    const user = userEvent.setup();
    render(
      <MoreOptions testId="automations-more-a">
        <span>Hidden content</span>
      </MoreOptions>,
    );
    await user.click(screen.getByTestId('automations-more-a'));
    await user.click(screen.getByTestId('automations-more-a'));
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
  });

  it('defaults its label to "More options" and reports aria-expanded', async () => {
    const user = userEvent.setup();
    render(
      <MoreOptions testId="automations-more-a">
        <span>x</span>
      </MoreOptions>,
    );
    const trigger = screen.getByTestId('automations-more-a');
    expect(trigger).toHaveTextContent('More options');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
