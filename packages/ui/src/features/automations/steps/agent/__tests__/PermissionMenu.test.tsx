/**
 * PermissionMenu — the Agent card's execution-scope chip (todo #234 T15),
 * over the contract's own `EXECUTION_MODES`. Unattended is the one mode that
 * runs without a human in the loop, so the chip goes destructive on it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EXECUTION_MODES } from '../../../contract';
import { PermissionMenu } from '../PermissionMenu';

describe('PermissionMenu', () => {
  it('defaults to the first execution mode when the step carries none', () => {
    render(<PermissionMenu value={undefined} onChange={vi.fn()} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-permission');
    expect(chip).toHaveTextContent('Interactive');
    expect(chip).toHaveAttribute('aria-label', 'Permission: Interactive');
  });

  it('falls back to the first mode when the wire carries one this build does not know', () => {
    render(<PermissionMenu value="plan" onChange={vi.fn()} testId="agent-a" />);
    expect(screen.getByTestId('agent-a-permission')).toHaveTextContent('Interactive');
  });

  it('offers every contract execution mode', async () => {
    const user = userEvent.setup();
    render(<PermissionMenu value="default" onChange={vi.fn()} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-permission'));
    for (const mode of EXECUTION_MODES) {
      expect(screen.getByTestId(`agent-a-permission-option-${mode}`)).toBeInTheDocument();
    }
  });

  it('patches the permission mode on pick', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PermissionMenu value="default" onChange={onChange} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-permission'));
    await user.click(screen.getByTestId('agent-a-permission-option-acceptEdits'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ permissionMode: 'acceptEdits' });
  });

  it('renders the chip destructive on yolo only', () => {
    const { rerender } = render(<PermissionMenu value="acceptEdits" onChange={vi.fn()} testId="agent-a" />);
    expect(screen.getByTestId('agent-a-permission').className).not.toContain('text-destructive');

    rerender(<PermissionMenu value="yolo" onChange={vi.fn()} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-permission');
    expect(chip).toHaveTextContent('Unattended');
    expect(chip.className).toContain('text-destructive');
  });
});
