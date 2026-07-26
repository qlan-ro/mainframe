/**
 * NotifyConfig — message TriggerTextField + auto-links note (ts153
 * wf2-stepconfig.jsx `WfNotifyConfig`, ported onto `NotifyStep.message`).
 * TDD: test written first, implemented after.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotifyStep } from '../../contract';
import { NotifyConfig, type NotifyConfigProps } from '../NotifyConfig';

function Field(props: Omit<NotifyConfigProps, 'onChange' | 'step'> & { initial: NotifyStep; onChange?: NotifyConfigProps['onChange'] }) {
  const { initial, onChange, ...rest } = props;
  const [step, setStep] = useState(initial);
  return (
    <NotifyConfig
      {...rest}
      step={step}
      onChange={(next) => {
        setStep(next);
        onChange?.(next);
      }}
    />
  );
}

describe('NotifyConfig', () => {
  it('renders a TriggerTextField bound to step.message', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: NotifyStep = { id: 'a', kind: 'notify', message: [] };
    render(<Field initial={step} onChange={onChange} tokens={[]} testId="automations-notify-a" />);
    await user.click(screen.getByTestId('automations-notify-a-message'));
    await user.keyboard('Ready to review');
    expect(onChange).toHaveBeenLastCalledWith({ ...step, message: ['Ready to review'] });
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
