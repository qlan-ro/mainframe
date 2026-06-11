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
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageViewer } from '../ImageViewer';

describe('ImageViewer', () => {
  it('renders with data-testid="viewer-image"', () => {
    render(<ImageViewer src="data:image/png;base64,abc" alt="test image" />);
    expect(screen.getByTestId('viewer-image')).toBeInTheDocument();
  });

  it('renders the image inside the viewer', () => {
    render(<ImageViewer src="data:image/png;base64,abc" alt="test" />);
    const root = screen.getByTestId('viewer-image');
    const img = root.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc');
  });

  it('renders the zoom trigger button', () => {
    render(<ImageViewer src="data:image/png;base64,abc" />);
    // ZoomableImage provides this testid
    expect(screen.getByTestId('chat-image-zoom-trigger')).toBeInTheDocument();
  });

  it('shows a loading placeholder when src is null', () => {
    render(<ImageViewer src={null} />);
    const root = screen.getByTestId('viewer-image');
    expect(root.querySelector('img')).toBeNull();
    // Should show some loading/empty indicator
    expect(root.textContent).toBeTruthy();
  });
});
