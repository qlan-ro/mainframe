import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { PreviewUrlBar } from '../PreviewUrlBar';

/** Every viewer/preview surface here renders v2 `Hint`s, which need the v2 TooltipProvider. */
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

function makeHandle(over: Partial<PreviewHandle> = {}): PreviewHandle {
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
    clearCache: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('PreviewUrlBar', () => {
  let handle: PreviewHandle;
  beforeEach(() => {
    handle = makeHandle();
  });

  it('shows the seed URL as the input value when enabled', () => {
    render(<PreviewUrlBar handle={handle} seedUrl="http://localhost:3000" enabled />);
    expect(screen.getByTestId('preview-url-input')).toHaveValue('http://localhost:3000');
  });

  it('Enter navigates to the normalized typed URL', () => {
    render(<PreviewUrlBar handle={handle} seedUrl="http://localhost:3000" enabled />);
    const input = screen.getByTestId('preview-url-input');
    fireEvent.change(input, { target: { value: 'localhost:3000/dashboard' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handle.navigate).toHaveBeenCalledWith('http://localhost:3000/dashboard');
  });

  it('Escape reverts the draft to the current URL', () => {
    render(<PreviewUrlBar handle={handle} seedUrl="http://localhost:3000" enabled />);
    const input = screen.getByTestId('preview-url-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'garbage' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('http://localhost:3000');
  });

  it('invalid input on Enter does not navigate', () => {
    render(<PreviewUrlBar handle={handle} seedUrl="http://localhost:3000" enabled />);
    const input = screen.getByTestId('preview-url-input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handle.navigate).not.toHaveBeenCalled();
  });

  it('marks the input aria-invalid on invalid Enter', () => {
    render(<PreviewUrlBar handle={handle} seedUrl="http://localhost:3000" enabled />);
    const input = screen.getByTestId('preview-url-input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables the input when not enabled', () => {
    render(<PreviewUrlBar handle={null} seedUrl={null} enabled={false} />);
    expect(screen.getByTestId('preview-url-input')).toBeDisabled();
  });

  it('keeps the input live but dims the actions when enabled with no handle', () => {
    render(<PreviewUrlBar handle={null} seedUrl="http://localhost:3000" enabled />);
    expect(screen.getByTestId('preview-url-input')).not.toBeDisabled();
    expect(screen.getByTestId('preview-url-reload')).toBeDisabled();
    expect(screen.getByTestId('preview-url-open-browser')).toBeDisabled();
    expect(screen.getByTestId('preview-url-clear-cache')).toBeDisabled();
  });

  it('Open in browser opens the current URL externally (not an in-webview navigate)', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<PreviewUrlBar handle={handle} seedUrl="http://localhost:3000" enabled />);
    fireEvent.click(screen.getByTestId('preview-url-open-browser'));
    expect(openSpy).toHaveBeenCalledWith('http://localhost:3000', '_blank', 'noopener,noreferrer');
    expect(handle.navigate).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('Clear cache clears the webview caches instead of navigating', () => {
    render(<PreviewUrlBar handle={handle} seedUrl="http://localhost:3000" enabled />);
    fireEvent.click(screen.getByTestId('preview-url-clear-cache'));
    expect(handle.clearCache).toHaveBeenCalledTimes(1);
    expect(handle.navigate).not.toHaveBeenCalled();
  });

  it('Reload reloads the URL the webview navigated to, not the seed', () => {
    let emit: ((url: string) => void) | null = null;
    handle = makeHandle({
      onNavigate: (cb: (url: string) => void) => {
        emit = cb;
        return () => {};
      },
    });
    render(<PreviewUrlBar handle={handle} seedUrl="http://localhost:3000" enabled />);
    act(() => emit!('http://localhost:3000/deep/page'));
    fireEvent.click(screen.getByTestId('preview-url-reload'));
    expect(handle.navigate).toHaveBeenCalledWith('http://localhost:3000/deep/page');
  });

  it('Enter hands a valid URL to onCommitUrl instead of navigating', () => {
    const onCommitUrl = vi.fn();
    render(<PreviewUrlBar handle={null} seedUrl="https://example.com/" enabled onCommitUrl={onCommitUrl} />);
    const input = screen.getByTestId('preview-url-input');
    fireEvent.change(input, { target: { value: 'example.com/docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommitUrl).toHaveBeenCalledTimes(1);
    expect(onCommitUrl).toHaveBeenCalledWith('http://example.com/docs');
  });

  it('Enter on an unsupported scheme neither commits nor navigates', () => {
    const onCommitUrl = vi.fn();
    render(<PreviewUrlBar handle={handle} seedUrl="https://example.com/" enabled onCommitUrl={onCommitUrl} />);
    const input = screen.getByTestId('preview-url-input');
    fireEvent.change(input, { target: { value: 'file:///etc/passwd' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommitUrl).not.toHaveBeenCalled();
    expect(handle.navigate).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
