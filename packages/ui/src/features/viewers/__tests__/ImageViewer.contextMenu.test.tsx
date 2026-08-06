/**
 * ImageViewer's context-menu reachability — the Files-surface mount point.
 *
 * `ImageViewer.test.tsx` mocks `ZoomableImage` away for its own rendering
 * contract, so it never proves the real `ZoomableImage → LightboxSurface →
 * ImageContextMenu` chain reaches the workspace surface. This suite renders the
 * real `ZoomableImage` (no mock) and asserts the menu opens, closing the gap
 * without pulling the Radix dialog into the mocked regression suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import { ImageViewer } from '../ImageViewer';

/** Every viewer/preview surface here renders v2 `Hint`s, which need the v2 TooltipProvider. */
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeEach(() => {
  vi.stubGlobal('ClipboardItem', class {});
  Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ImageViewer — image context menu reachability (Files surface)', () => {
  it('opens the image context menu on the opened image', async () => {
    render(<ImageViewer src={PNG_DATA_URI} path="/a/b/test.png" />);

    fireEvent.click(screen.getByTestId('chat-image-zoom-trigger'));
    await screen.findByTestId('chat-image-zoom-dialog');

    fireEvent.contextMenu(screen.getByTestId('chat-image-zoom-image'));

    expect(screen.getByTestId('image-context-menu')).toBeInTheDocument();
    expect(screen.getByTestId('image-copy').textContent).toContain('Copy Image');
  });
});
