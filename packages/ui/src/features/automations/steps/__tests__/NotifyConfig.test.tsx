/**
 * NotifyConfig — message ChipField + auto-links note (ts153
 * wf2-stepconfig.jsx `WfNotifyConfig`, ported onto `NotifyStep.message`).
 * TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotifyStep } from '../../contract';
import { NotifyConfig } from '../NotifyConfig';

describe('NotifyConfig', () => {
  it('renders a ChipField bound to step.message', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: NotifyStep = { id: 'a', kind: 'notify', message: [] };
    render(<NotifyConfig step={step} onChange={onChange} tokens={[]} testId="automations-notify-a" />);
    await user.click(screen.getByTestId('automations-notify-a-message'));
    await user.keyboard('Ready to review');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({ ...step, message: ['Ready to review'] });
  });

  it('shows a note that run/chat links are added automatically', () => {
    const step: NotifyStep = { id: 'a', kind: 'notify', message: [] };
    render(<NotifyConfig step={step} onChange={vi.fn()} tokens={[]} testId="automations-notify-a" />);
    expect(screen.getByText(/links to the run/i)).toBeInTheDocument();
  });

  it('renders FailureToggle under More options, patching step.keepGoing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: NotifyStep = { id: 'a', kind: 'notify', message: [] };
    render(<NotifyConfig step={step} onChange={onChange} tokens={[]} testId="automations-notify-a" />);
    await user.click(screen.getByTestId('automations-notify-a-more'));
    await user.click(screen.getByTestId('automations-notify-a-keepgoing'));
    expect(onChange).toHaveBeenCalledWith({ ...step, keepGoing: true });
  });
});
