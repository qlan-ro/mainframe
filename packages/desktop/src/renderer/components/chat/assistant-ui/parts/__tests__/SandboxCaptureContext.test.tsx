import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SandboxCaptureContext } from '../SandboxCaptureContext.js';

const rows = [
  { label: 'element1', imageName: 'element1.png', selector: 'div.card > h2', annotation: 'note' },
  { label: 'screenshot1', imageName: 'screenshot1.png' },
];
const images = { 'element1.png': 'data:image/png;base64,QUJD', 'screenshot1.png': 'data:image/png;base64,QUJD' };

describe('SandboxCaptureContext', () => {
  it('renders a row per capture: breadcrumb + annotation + thumbnail', () => {
    render(<SandboxCaptureContext rows={rows} images={images} />);
    expect(screen.getAllByTestId('selector-crumb').map((s) => s.textContent)).toEqual(['div.card', 'h2']);
    expect(screen.getByText('note')).toBeTruthy();
    expect(screen.getAllByRole('img').length).toBe(2);
  });
  it('falls back to the label when no selector', () => {
    render(<SandboxCaptureContext rows={[{ label: 'screenshot1', imageName: 'screenshot1.png' }]} images={images} />);
    expect(screen.getByText('screenshot1')).toBeTruthy();
  });
  it('renders nothing for empty rows', () => {
    const { container } = render(<SandboxCaptureContext rows={[]} images={{}} />);
    expect(container.querySelector('[data-testid="sandbox-capture-context"]')).toBeNull();
  });
  it('shows a remove control only when onRemove is given and fires it with the label', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<SandboxCaptureContext rows={rows} images={images} />);
    expect(screen.queryByTestId('capture-remove')).toBeNull();
    rerender(<SandboxCaptureContext rows={rows} images={images} onRemove={onRemove} />);
    const btns = screen.getAllByTestId('capture-remove');
    expect(btns.length).toBe(2);
    fireEvent.click(btns[0]!);
    expect(onRemove).toHaveBeenCalledWith('element1');
  });
});
