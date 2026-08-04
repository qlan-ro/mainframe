import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from '../confirm-dialog';

describe('ConfirmDialog suppress row', () => {
  it('renders nothing extra when no suppress prop is given', () => {
    render(<ConfirmDialog open title="Delete session?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('confirm-dialog-suppress')).toBeNull();
    expect(screen.getByTestId('confirm-dialog-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
  });

  it('renders a labeled checkbox when a suppress prop is given', () => {
    render(
      <ConfirmDialog
        open
        title="Change model?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        suppress={{ label: "Don't warn again", checked: false, onChange: vi.fn() }}
      />,
    );
    const checkbox = screen.getByTestId('confirm-dialog-suppress');
    expect(checkbox).toBeInTheDocument();
    expect(screen.getByLabelText("Don't warn again")).toBe(checkbox);
  });

  it('calls onChange with the toggled value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Change model?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        suppress={{ label: "Don't warn again", checked: false, onChange }}
      />,
    );
    await user.click(screen.getByTestId('confirm-dialog-suppress'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    rerender(
      <ConfirmDialog
        open
        title="Change model?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        suppress={{ label: "Don't warn again", checked: true, onChange }}
      />,
    );
    await user.click(screen.getByTestId('confirm-dialog-suppress'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('prefixes the suppress testid with a custom testid prop', () => {
    render(
      <ConfirmDialog
        open
        title="Change effort?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        testid="x"
        suppress={{ label: "Don't warn again", checked: false, onChange: vi.fn() }}
      />,
    );
    expect(screen.getByTestId('x-suppress')).toBeInTheDocument();
  });

  it('routes confirm and cancel clicks to their own handlers only', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete session?" onConfirm={onConfirm} onCancel={onCancel} />);

    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    onConfirm.mockClear();
    await user.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
