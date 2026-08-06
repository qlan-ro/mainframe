/**
 * AdvancedSection — the Agent card's rarely-touched fields (todo #234 T15).
 * The toggle sits in the toolbar row and the panel below it, so the two ship
 * as separate exports and the card owns the open state.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AskAgentStep } from '../../../contract';
import { AdvancedSection, AdvancedToggle } from '../AdvancedSection';

const STEP: AskAgentStep = { id: 'a', kind: 'ask_agent', prompt: [] };

function Toggle() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AdvancedToggle open={open} onToggle={() => setOpen((o) => !o)} testId="agent-a" />
      {open && <AdvancedSection step={STEP} onChange={vi.fn()} testId="agent-a" />}
    </>
  );
}

describe('AdvancedToggle', () => {
  it('is a labelled disclosure that reveals the advanced fields', async () => {
    const user = userEvent.setup();
    render(<Toggle />);
    const toggle = screen.getByTestId('agent-a-advanced-toggle');
    expect(toggle).toHaveAttribute('aria-label', 'More options');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('agent-a-timeout')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByTestId('agent-a-advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('agent-a-timeout')).toBeInTheDocument();
  });

  it('highlights itself while the panel is open', () => {
    const { rerender } = render(<AdvancedToggle open={false} onToggle={vi.fn()} testId="agent-a" />);
    expect(screen.getByTestId('agent-a-advanced-toggle').className).not.toContain('bg-mf-selection');

    rerender(<AdvancedToggle open onToggle={vi.fn()} testId="agent-a" />);
    expect(screen.getByTestId('agent-a-advanced-toggle').className).toContain('bg-sidebar-selection');
  });
});

describe('AdvancedSection', () => {
  it('adds an attachment', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdvancedSection step={STEP} onChange={onChange} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-attachments-add'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ attachments: ['screenshot-1.png'] });
  });

  it('patches the timeout from the numeric input, and clears it when emptied', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<AdvancedSection step={STEP} onChange={onChange} testId="agent-a" />);
    await user.type(screen.getByTestId('agent-a-timeout'), '4');
    expect(onChange).toHaveBeenLastCalledWith({ timeoutMinutes: 4 });

    rerender(<AdvancedSection step={{ ...STEP, timeoutMinutes: 4 }} onChange={onChange} testId="agent-a" />);
    await user.clear(screen.getByTestId('agent-a-timeout'));
    expect(onChange).toHaveBeenLastCalledWith({ timeoutMinutes: undefined });
  });

  it('patches keepGoing from the on-failure switch', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdvancedSection step={STEP} onChange={onChange} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-keepgoing'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ keepGoing: true });
  });

  it('renders the expected-results builder bound to step.expects', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdvancedSection step={STEP} onChange={onChange} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-expects-add'));
    const patch = onChange.mock.calls[0]?.[0] as Partial<AskAgentStep> | undefined;
    expect(patch?.expects).toHaveLength(1);
  });
});
