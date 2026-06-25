import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CaptureAnnotationPopover } from '../CaptureAnnotationPopover';

const mockCaptures = [
  { id: 'cap-1', type: 'screenshot' as const, imageDataUrl: 'data:image/png;base64,abc' },
  { id: 'cap-2', type: 'element' as const, imageDataUrl: 'data:image/png;base64,def', selector: '.btn' },
];

describe('CaptureAnnotationPopover', () => {
  it('renders all captures', () => {
    const { getByTestId } = render(
      <CaptureAnnotationPopover
        captures={mockCaptures}
        onAnnotationChange={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    expect(getByTestId('preview-annotation-popover')).toBeTruthy();
    expect(getByTestId('preview-annotation-item-cap-1')).toBeTruthy();
    expect(getByTestId('preview-annotation-item-cap-2')).toBeTruthy();
  });

  it('calls onAnnotationChange when textarea changes', () => {
    const onAnnotationChange = vi.fn();
    const { getByTestId } = render(
      <CaptureAnnotationPopover
        captures={mockCaptures}
        onAnnotationChange={onAnnotationChange}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    const input = getByTestId('preview-annotation-input-cap-1');
    fireEvent.change(input, { target: { value: 'test annotation' } });
    expect(onAnnotationChange).toHaveBeenCalledWith('cap-1', 'test annotation');
  });

  it('calls onSubmit when submit button clicked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { getByTestId } = render(
      <CaptureAnnotationPopover
        captures={mockCaptures}
        onAnnotationChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(getByTestId('preview-annotation-submit'));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    const { getByTestId } = render(
      <CaptureAnnotationPopover
        captures={mockCaptures}
        onAnnotationChange={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(getByTestId('preview-annotation-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
