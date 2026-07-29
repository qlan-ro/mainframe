/**
 * RED phase (Group `menu-tests`): `../ImageContextMenu` does not exist yet.
 * Every case below fails on module resolution until Group `image-context-menu`
 * adds it — that failure, and only that failure, is expected here.
 *
 * Mock strategy: the real `lib/clipboard/image-source` gate runs unmocked (a
 * `beforeEach` installs `ClipboardItem` + `navigator.clipboard.write` so
 * `canCopyImage` reports true for `data:image/*` sources); `copyImageToClipboard`
 * and `mfToast` are mocked at the module boundary. Radix context menus open on
 * `fireEvent.contextMenu` per the shipped precedent (`SessionContextMenu.test.tsx`,
 * `MessagePathContextMenu.test.tsx`), and the delayed-close timer is driven with
 * fake timers the same way `MessagePathContextMenu.test.tsx` does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ImageContextMenu } from '../ImageContextMenu';
import { ZoomableImage } from '../ZoomableImage';
import { ImageLightbox } from '../ImageLightbox';
import { MessagePathContextMenu } from '../../messages/MessagePathContextMenu';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { copyImageToClipboard } from '@/lib/clipboard/copy-image';
import { mfToast } from '@/lib/toast';

vi.mock('@/lib/clipboard/copy-image', () => ({ copyImageToClipboard: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn() } }));

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const HTTPS_SRC = 'https://example.com/photo.png';

function Fixture({ src }: { src: string }) {
  return (
    <ImageContextMenu src={src}>
      <img data-testid="fixture-image" src={src} alt="" />
    </ImageContextMenu>
  );
}

/** Lets the copy promise settle so the copy feedback lands. */
async function flushCopy(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function stubClipboardSupport() {
  vi.stubGlobal('ClipboardItem', class {});
  Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stubClipboardSupport();
  vi.mocked(copyImageToClipboard).mockReset();
  vi.mocked(mfToast.error).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ImageContextMenu — mounting the menu', () => {
  it('opens image-context-menu with a Copy Image item for a copyable data URI on a supported host', () => {
    render(<Fixture src={PNG_DATA_URI} />);

    fireEvent.contextMenu(screen.getByTestId('fixture-image'));

    const menu = screen.getByTestId('image-context-menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByTestId('image-copy').textContent).toContain('Copy Image');
  });

  it('mounts no menu for an unsupported https source, even though the host supports image-clipboard writes', () => {
    render(<Fixture src={HTTPS_SRC} />);

    fireEvent.contextMenu(screen.getByTestId('fixture-image'));

    expect(screen.queryByTestId('image-context-menu')).toBeNull();
    expect(screen.getByTestId('fixture-image')).toBeInTheDocument();
  });

  it('mounts no menu for a copyable data URI when the host has no ClipboardItem support', () => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true });

    render(<Fixture src={PNG_DATA_URI} />);
    fireEvent.contextMenu(screen.getByTestId('fixture-image'));

    expect(screen.queryByTestId('image-context-menu')).toBeNull();
    expect(screen.getByTestId('fixture-image')).toBeInTheDocument();
  });
});

describe('ImageContextMenu — copy outcome', () => {
  it('calls copyImageToClipboard synchronously with the click, then reports Copied with no error toast', async () => {
    vi.mocked(copyImageToClipboard).mockResolvedValue({ ok: true });
    render(<Fixture src={PNG_DATA_URI} />);
    fireEvent.contextMenu(screen.getByTestId('fixture-image'));

    fireEvent.click(screen.getByTestId('image-copy'));

    // D4 user-activation: the call must precede any await/waitFor.
    expect(copyImageToClipboard).toHaveBeenCalledTimes(1);
    expect(copyImageToClipboard).toHaveBeenCalledWith(PNG_DATA_URI);

    await flushCopy();

    expect(screen.getByTestId('image-copy').textContent).toContain('Copied');
    expect(mfToast.error).not.toHaveBeenCalled();
  });

  it('reports Copy failed and raises mfToast.error carrying the failure reason', async () => {
    vi.mocked(copyImageToClipboard).mockResolvedValue({ ok: false, message: 'boom' });
    render(<Fixture src={PNG_DATA_URI} />);
    fireEvent.contextMenu(screen.getByTestId('fixture-image'));

    fireEvent.click(screen.getByTestId('image-copy'));
    await flushCopy();

    expect(screen.getByTestId('image-copy').textContent).toContain('Copy failed');
    expect(mfToast.error).toHaveBeenCalledTimes(1);
    expect(mfToast.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ description: 'boom' }));
  });
});

describe('ImageContextMenu — both LightboxSurface render paths', () => {
  it('appears on the assistant image-part path (ZoomableImage → LightboxSurface)', async () => {
    render(<ZoomableImage src={PNG_DATA_URI} />);

    fireEvent.click(screen.getByTestId('chat-image-zoom-trigger'));
    await screen.findByTestId('chat-image-zoom-dialog');

    fireEvent.contextMenu(screen.getByTestId('chat-image-zoom-image'));

    expect(screen.getByTestId('image-context-menu')).toBeInTheDocument();
  });

  it('appears on the user-gallery path (ImageLightbox → LightboxSurface)', () => {
    render(<ImageLightbox images={[{ src: PNG_DATA_URI }]} index={0} onIndexChange={vi.fn()} />);

    fireEvent.contextMenu(screen.getByTestId('image-lightbox-current'));

    expect(screen.getByTestId('image-context-menu')).toBeInTheDocument();
  });
});

describe('ImageContextMenu — nested inside MessagePathContextMenu', () => {
  beforeEach(() => {
    useActiveBasesStore.setState({ bases: { worktreePath: '/w', projectPath: '/p' }, scopeKey: null });
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as unknown as Selection);
  });

  it('opens only the image menu, never the outer message-path menu, on the lightbox image', async () => {
    render(
      <MessagePathContextMenu>
        <ZoomableImage src={PNG_DATA_URI} />
      </MessagePathContextMenu>,
    );

    fireEvent.click(screen.getByTestId('chat-image-zoom-trigger'));
    await screen.findByTestId('chat-image-zoom-dialog');

    fireEvent.contextMenu(screen.getByTestId('chat-image-zoom-image'));

    expect(screen.getByTestId('image-context-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-card-path-copy-absolute')).toBeNull();
  });
});

describe('ImageContextMenu — dismissal does not reach the lightbox', () => {
  async function openDialogAndMenu() {
    render(<ZoomableImage src={PNG_DATA_URI} />);
    fireEvent.click(screen.getByTestId('chat-image-zoom-trigger'));
    await screen.findByTestId('chat-image-zoom-dialog');
    fireEvent.contextMenu(screen.getByTestId('chat-image-zoom-image'));
    await screen.findByTestId('image-context-menu');
  }

  it('Escape closes only the menu; the lightbox dialog stays open, and a later plain click still dismisses it', async () => {
    await openDialogAndMenu();

    fireEvent.keyDown(screen.getByTestId('image-context-menu'), { key: 'Escape' });
    expect(screen.queryByTestId('image-context-menu')).toBeNull();
    expect(screen.getByTestId('chat-image-zoom-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-image-zoom-image'));
    expect(screen.queryByTestId('chat-image-zoom-dialog')).toBeNull();
  });

  it('an outside pointerdown that closes the menu does not close the lightbox', async () => {
    await openDialogAndMenu();

    act(() => {
      vi.advanceTimersByTime(0);
    });
    fireEvent.pointerDown(document.body);

    expect(screen.queryByTestId('image-context-menu')).toBeNull();
    expect(screen.getByTestId('chat-image-zoom-dialog')).toBeInTheDocument();
  });

  it('a copy that settles after the menu was dismissed does not close the lightbox (D13)', async () => {
    let resolveCopy: (outcome: { ok: boolean }) => void = () => undefined;
    vi.mocked(copyImageToClipboard).mockReturnValue(
      new Promise((resolve) => {
        resolveCopy = resolve;
      }),
    );
    await openDialogAndMenu();

    fireEvent.click(screen.getByTestId('image-copy'));
    fireEvent.keyDown(screen.getByTestId('image-context-menu'), { key: 'Escape' });
    expect(screen.queryByTestId('image-context-menu')).toBeNull();

    resolveCopy({ ok: true });
    await flushCopy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('chat-image-zoom-dialog')).toBeInTheDocument();
  });
});
