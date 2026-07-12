/**
 * FailureToggle — "Keep going if this step fails", writing `step.keepGoing`
 * (ts153 wf2-stepconfig.jsx `WfFailureToggle`, ported onto the contract's
 * exact wire field name — `keepGoing`, NOT `continueOnError`). TDD: test
 * written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FailureToggle } from '../FailureToggle';

describe('FailureToggle', () => {
  it('renders unchecked when keepGoing is false/undefined', () => {
    render(<FailureToggle keepGoing={false} onChange={vi.fn()} testId="automations-keepgoing-a" />);
    expect(screen.getByTestId('automations-keepgoing-a')).not.toBeChecked();
  });

  it('renders checked when keepGoing is true', () => {
    render(<FailureToggle keepGoing={true} onChange={vi.fn()} testId="automations-keepgoing-a" />);
    expect(screen.getByTestId('automations-keepgoing-a')).toBeChecked();
  });

  it('calls onChange(true) when toggled on', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FailureToggle keepGoing={false} onChange={onChange} testId="automations-keepgoing-a" />);
    await user.click(screen.getByTestId('automations-keepgoing-a'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('labels the toggle "Keep going if this step fails"', () => {
    render(<FailureToggle keepGoing={false} onChange={vi.fn()} testId="automations-keepgoing-a" />);
    expect(screen.getByText('Keep going if this step fails')).toBeInTheDocument();
  });
});
