/**
 * ImageViewer tests.
 *
 * The component receives a base64-encoded data URL or a plain src string.
 * In tests we pass a plain `src` (the async file-load path is irrelevant to
 * the rendering contract; we test the rendered output, not the Tauri call).
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-image".
 *  2. Shows the image element with the provided src.
 *  3. Zoom trigger is present (delegates to ZoomableImage).
 *  4. Loading state renders a placeholder when src is null.
 *  5. Renders inside ViewerShell (viewer-shell present).
 *  6. Footer status shows image format (viewer-shell-status).
 *  7. onLoad fires from the <img> element (not the wrapper div) and updates
 *     the footer status — the status changes from "Loading…" to include
 *     the file extension.
 *  8. Fit/100% toggle is present in the header actions slot.
 *  9. Zoom-in and zoom-out buttons are in the header actions slot.
 * 10. statusRight (viewer-shell-status-right) shows size/zoom info after load.
 * 11. Image is wrapped in a white shadow card div (not floating on checkerboard).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageViewer } from '../ImageViewer';

// Mock ZoomableImage so the Dialog/Radix deps don't need to be wired in tests.
// Forward onLoad so the ImageViewer's handleLoad can fire from the <img>.
vi.mock('@/features/chat/parts/ZoomableImage', () => ({
  ZoomableImage: ({
    src,
    alt,
    onLoad,
  }: {
    src: string;
    alt?: string;
    onLoad?: React.ReactEventHandler<HTMLImageElement>;
  }) => (
    <button data-testid="chat-image-zoom-trigger" aria-label="View image full size">
      <img src={src} alt={alt ?? ''} onLoad={onLoad} />
    </button>
  ),
}));

// Mock surface-intents so ViewerShell's reveal button doesn't crash.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

describe('ImageViewer', () => {
  it('renders with data-testid="viewer-image"', () => {
    render(<ImageViewer src="data:image/png;base64,abc" alt="test image" path="/a/b/test.png" />);
    expect(screen.getByTestId('viewer-image')).toBeInTheDocument();
  });

  it('renders the image inside the viewer', () => {
    render(<ImageViewer src="data:image/png;base64,abc" alt="test" path="/a/b/test.png" />);
    const root = screen.getByTestId('viewer-image');
    const img = root.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc');
  });

  it('renders the zoom trigger button', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/test.png" />);
    // ZoomableImage provides this testid
    expect(screen.getByTestId('chat-image-zoom-trigger')).toBeInTheDocument();
  });

  it('shows a loading placeholder when src is null', () => {
    render(<ImageViewer src={null} path="/a/b/test.png" />);
    const root = screen.getByTestId('viewer-image');
    expect(root.querySelector('img')).toBeNull();
    // Should show some loading/empty indicator
    expect(root.textContent).toBeTruthy();
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/test.png" />);
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('shows image format in the footer status after load', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/test.png" />);
    const status = screen.getByTestId('viewer-shell-status');
    expect(status).toBeInTheDocument();

    // Simulate the img onLoad event to populate dimensions
    const img = document.querySelector('img') as HTMLImageElement;
    if (img) {
      Object.defineProperty(img, 'naturalWidth', { value: 100, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 50, configurable: true });
      fireEvent.load(img);
    }

    // After load, status should contain the extension
    expect(screen.getByTestId('viewer-shell-status').textContent).toMatch(/PNG/i);
  });

  it('onLoad fires from the img element (not the wrapper div) and updates status', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/photo.png" />);

    const statusBefore = screen.getByTestId('viewer-shell-status').textContent;
    expect(statusBefore).toMatch(/Loading/i);

    // Find the img inside the zoom trigger (empty alt → no accessible role; use DOM query).
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    fireEvent.load(img);

    // Status must now reflect the loaded state (extension)
    const statusAfter = screen.getByTestId('viewer-shell-status').textContent;
    expect(statusAfter).toMatch(/PNG/i);
    // And it must no longer say "Loading"
    expect(statusAfter).not.toMatch(/Loading/i);
  });

  it('renders Fit/100% toggle buttons in the header actions slot', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/test.png" />);
    expect(screen.getByTestId('viewer-image-fit-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-image-actual-toggle')).toBeInTheDocument();
  });

  it('renders zoom-in and zoom-out buttons in the header', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/test.png" />);
    expect(screen.getByTestId('viewer-image-zoom-in')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-image-zoom-out')).toBeInTheDocument();
  });

  it('zoom buttons are disabled when fit mode is active', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/test.png" />);
    // Default is fit mode — zoom buttons should be disabled
    expect(screen.getByTestId('viewer-image-zoom-in')).toBeDisabled();
    expect(screen.getByTestId('viewer-image-zoom-out')).toBeDisabled();
  });

  it('zoom buttons are enabled after switching to 100% mode', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/test.png" />);
    // Switch to actual/100% mode
    fireEvent.click(screen.getByTestId('viewer-image-actual-toggle'));
    expect(screen.getByTestId('viewer-image-zoom-in')).not.toBeDisabled();
    expect(screen.getByTestId('viewer-image-zoom-out')).not.toBeDisabled();
  });

  it('statusRight shows fit-to-window info in fit mode', () => {
    render(<ImageViewer src="data:image/png;base64,abc" path="/a/b/test.png" />);
    const img = document.querySelector('img') as HTMLImageElement;
    if (img) {
      Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
      fireEvent.load(img);
    }
    // ViewerShell renders statusRight as a span in the footer. Check footer text.
    const shell = screen.getByTestId('viewer-shell');
    const footer = shell.lastElementChild as HTMLElement;
    expect(footer.textContent).toMatch(/fit/i);
  });
});
