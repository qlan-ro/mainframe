/**
 * WfExprInput — chip raw-edit staleness guard.
 *
 * `WfExprInputEditor` mounts real CodeMirror (Task 17); these tests exercise
 * the chip-edit mini-editor state machine that lives in WfExprInput itself
 * (chipEdit.from/to captured at click time), not CM6, so a plain stub stands
 * in for it — same mocking approach as WfStepConfigForm.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WfExprInput } from '@/features/workflows/editor/config/WfExprInput';

vi.mock('@/features/workflows/editor/config/WfExprInputEditor', () => ({
  WfExprInputEditor: ({ testId, onChipClick }: { testId: string; onChipClick: (from: number, to: number) => void }) => (
    <button data-testid={`${testId}-chip-stub`} onClick={() => onChipClick(0, 4)} />
  ),
}));

describe('WfExprInput chip raw-edit staleness guard', () => {
  it('opens the chip edit box with the clicked range snapshotted', async () => {
    render(<WfExprInput value="${a} rest" onChange={vi.fn()} scope={[]} testId="x" />);
    fireEvent.click(await screen.findByTestId('x-chip-stub'));

    expect(screen.getByTestId('x-chip-edit-input')).toHaveValue('${a}');
  });

  it('auto-cancels the chip edit when the value prop changes while it is open', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<WfExprInput value="${a} rest" onChange={onChange} scope={[]} testId="x" />);
    fireEvent.click(await screen.findByTestId('x-chip-stub'));
    expect(screen.getByTestId('x-chip-edit')).toBeInTheDocument();

    rerender(<WfExprInput value="${a} rest, edited elsewhere" onChange={onChange} scope={[]} testId="x" />);

    expect(screen.queryByTestId('x-chip-edit')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still saves a non-stale chip edit normally', async () => {
    const onChange = vi.fn();
    render(<WfExprInput value="${a} rest" onChange={onChange} scope={[]} testId="x" />);
    fireEvent.click(await screen.findByTestId('x-chip-stub'));

    fireEvent.change(screen.getByTestId('x-chip-edit-input'), { target: { value: '${b}' } });
    fireEvent.click(screen.getByTestId('x-chip-edit-save'));

    expect(onChange).toHaveBeenCalledWith('${b} rest');
  });
});
