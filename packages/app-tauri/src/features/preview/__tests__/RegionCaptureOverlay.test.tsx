import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RegionCaptureOverlay } from '../RegionCaptureOverlay';

describe('RegionCaptureOverlay', () => {
  it('renders overlay with testid', () => {
    const { getByTestId } = render(
      <RegionCaptureOverlay onRegionSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(getByTestId('preview-region-overlay')).toBeTruthy();
  });

  it('calls onRegionSelect with normalized rect on mouseup', () => {
    const onRegionSelect = vi.fn();
    const { getByTestId } = render(
      <RegionCaptureOverlay onRegionSelect={onRegionSelect} onClose={vi.fn()} />,
    );
    const overlay = getByTestId('preview-region-overlay');
    fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(overlay, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(overlay, { clientX: 200, clientY: 200 });
    expect(onRegionSelect).toHaveBeenCalledWith({ x: 100, y: 100, w: 100, h: 100 });
  });

  it('normalizes rect when dragging from bottom-right to top-left', () => {
    const onRegionSelect = vi.fn();
    const { getByTestId } = render(
      <RegionCaptureOverlay onRegionSelect={onRegionSelect} onClose={vi.fn()} />,
    );
    const overlay = getByTestId('preview-region-overlay');
    fireEvent.mouseDown(overlay, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(overlay, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(overlay, { clientX: 100, clientY: 100 });
    expect(onRegionSelect).toHaveBeenCalledWith({ x: 100, y: 100, w: 200, h: 200 });
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <RegionCaptureOverlay onRegionSelect={vi.fn()} onClose={onClose} />,
    );
    const overlay = getByTestId('preview-region-overlay');
    fireEvent.keyDown(overlay, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows selection rect during drag', () => {
    const { getByTestId, queryByTestId } = render(
      <RegionCaptureOverlay onRegionSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const overlay = getByTestId('preview-region-overlay');
    expect(queryByTestId('preview-region-selection')).toBeNull();
    fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(overlay, { clientX: 200, clientY: 200 });
    expect(getByTestId('preview-region-selection')).toBeTruthy();
  });
});
