import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { PreviewUrlBar } from '../PreviewUrlBar';

function makeHandle(): PreviewHandle {
  return {
    setVisible: vi.fn(),
    compositesAboveDom: true,
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(new Uint8Array()),
    startInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockReturnValue(() => {}),
    startRegionSelect: vi.fn().mockResolvedValue(undefined),
    onRegionSelect: vi.fn().mockReturnValue(() => {}),
    onNavigate: vi.fn().mockReturnValue(() => {}),
    refit: vi.fn(),
    setDevice: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('PreviewUrlBar', () => {
  let handle: PreviewHandle;
  beforeEach(() => {
    handle = makeHandle();
  });

  it('shows localhost:{port} as the input value when running', () => {
    render(<PreviewUrlBar handle={handle} port={3000} isRunning />);
    expect(screen.getByTestId('preview-url-input')).toHaveValue('http://localhost:3000');
  });

  it('Enter navigates to the normalized typed URL', () => {
    render(<PreviewUrlBar handle={handle} port={3000} isRunning />);
    const input = screen.getByTestId('preview-url-input');
    fireEvent.change(input, { target: { value: 'localhost:3000/dashboard' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handle.navigate).toHaveBeenCalledWith('http://localhost:3000/dashboard');
  });

  it('Escape reverts the draft to the current URL', () => {
    render(<PreviewUrlBar handle={handle} port={3000} isRunning />);
    const input = screen.getByTestId('preview-url-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'garbage' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('http://localhost:3000');
  });

  it('invalid input on Enter does not navigate', () => {
    render(<PreviewUrlBar handle={handle} port={3000} isRunning />);
    const input = screen.getByTestId('preview-url-input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handle.navigate).not.toHaveBeenCalled();
  });

  it('applies the invalid (ring-destructive) state on invalid Enter', () => {
    render(<PreviewUrlBar handle={handle} port={3000} isRunning />);
    const input = screen.getByTestId('preview-url-input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveClass('ring-destructive');
  });

  it('disables the input when not running', () => {
    render(<PreviewUrlBar handle={null} port={null} isRunning={false} />);
    expect(screen.getByTestId('preview-url-input')).toBeDisabled();
  });

  it('Open in browser opens the current URL externally (not an in-webview navigate)', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<PreviewUrlBar handle={handle} port={3000} isRunning />);
    fireEvent.click(screen.getByTestId('preview-url-open-browser'));
    expect(openSpy).toHaveBeenCalledWith('http://localhost:3000', '_blank', 'noopener,noreferrer');
    expect(handle.navigate).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
