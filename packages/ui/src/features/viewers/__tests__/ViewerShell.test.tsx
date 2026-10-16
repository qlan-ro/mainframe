/**
 * ViewerShell tests.
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-shell".
 *  2. Breadcrumb: dir segments render separately from the basename; the dir
 *     and basename elements carry the right content.
 *  3. No-dir path (e.g. "file.png") renders only the basename with no dir
 *     segment.
 *  4. Empty path renders something (no crash, basename falls back to path).
 *  5. Reveal button present (data-testid="viewer-shell-reveal") and on click
 *     calls emitSurfaceIntent({ type: 'reveal-file', path }).
 *  6. Status string renders in viewer-shell-status.
 *  7. Optional statusRight renders right-aligned in the footer.
 *  8. Children render in the body area.
 *  9. Optional actions node renders in the header.
 * 10. Separator (bg-border w-px) is always present even with no actions.
 * 11. Reveal in Finder (data-testid="viewer-shell-reveal-finder") calls
 *     host.fs.showItemInFolder with the absolute path, resolving relative
 *     paths against the active workspace base.
 * 12. Reveal in Finder is disabled under a remote daemon, and for a relative
 *     path with no known base.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import userEvent from '@testing-library/user-event';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { ViewerShell } from '../ViewerShell';

vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

let daemonIsLocal = true;
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => daemonIsLocal }));

// Import after mock so we get the mocked version.
import { emitSurfaceIntent } from '@/store/surface-intents';

/** Every viewer/preview surface here renders v2 `Hint`s, which need the v2 TooltipProvider. */
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

const mockEmit = emitSurfaceIntent as ReturnType<typeof vi.fn>;

let fakeHost: FakeHostBridge;

beforeEach(() => {
  mockEmit.mockClear();
  daemonIsLocal = true;
  useActiveBasesStore.setState({ bases: {} });
  fakeHost = new FakeHostBridge();
  vi.spyOn(fakeHost.fs, 'showItemInFolder').mockResolvedValue(undefined);
});

function renderWithHost(path: string) {
  return render(
    <HostProvider host={fakeHost}>
      <ViewerShell path={path} status="HTML">
        <div>body</div>
      </ViewerShell>
    </HostProvider>,
  );
}

describe('ViewerShell', () => {
  it('renders with data-testid="viewer-shell"', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('renders the dir portion "a/b" and basename "file.png" as separate text nodes', () => {
    const { container } = render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    // The dir segments "a" and "b" render as individual spans.
    const allSpans = Array.from(container.querySelectorAll('span'));
    const texts = allSpans.map((s) => s.textContent);
    expect(texts).toContain('a');
    expect(texts).toContain('b');
    // The basename is in its own semibold span.
    const basename = allSpans.find((s) => s.textContent === 'file.png');
    expect(basename).toBeDefined();
    expect(basename?.className).toContain('font-semibold');
  });

  it('renders only basename for a no-dir path', () => {
    const { container } = render(
      <ViewerShell path="file.png" status="PNG">
        <div>body</div>
      </ViewerShell>,
    );
    // Basename must be present.
    expect(screen.getByTestId('viewer-shell')).toHaveTextContent('file.png');
    // No dir-level muted spans containing path segments.
    const dirSpans = Array.from(container.querySelectorAll('span')).filter(
      (s) => s.className.includes('text-muted-foreground') && s.textContent === 'file.png',
    );
    // The dir-color span should not contain the basename text.
    expect(dirSpans).toHaveLength(0);
  });

  it('renders reveal button with data-testid="viewer-shell-reveal"', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('viewer-shell-reveal')).toBeInTheDocument();
  });

  it('calls emitSurfaceIntent with reveal-file intent on reveal button click', async () => {
    const user = userEvent.setup();
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    await user.click(screen.getByTestId('viewer-shell-reveal'));
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'reveal-file', path: '/a/b/file.png' });
  });

  it('renders the status string in viewer-shell-status', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('viewer-shell-status')).toHaveTextContent('PNG · 10×10 · 1 KB');
  });

  it('renders optional statusRight in the footer', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG" statusRight="248 KB">
        <div>body</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('viewer-shell')).toHaveTextContent('248 KB');
  });

  it('renders children in the body area', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div data-testid="child-content">hello child</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('child-content')).toHaveTextContent('hello child');
  });

  it('renders the optional actions node in the header', () => {
    render(
      <ViewerShell
        path="/a/b/file.png"
        status="PNG · 10×10 · 1 KB"
        actions={<button data-testid="custom-action">action</button>}
      >
        <div>body</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('custom-action')).toBeInTheDocument();
  });

  describe('Reveal in Finder', () => {
    it('reveals an absolute path in Finder', async () => {
      const user = userEvent.setup();
      renderWithHost('/Users/me/Downloads/report.html');
      await user.click(screen.getByTestId('viewer-shell-reveal-finder'));
      expect(fakeHost.fs.showItemInFolder).toHaveBeenCalledWith('/Users/me/Downloads/report.html');
    });

    it('resolves a relative path against the active worktree', async () => {
      useActiveBasesStore.setState({ bases: { worktreePath: '/Users/me/proj/.wt/a', projectPath: '/Users/me/proj' } });
      const user = userEvent.setup();
      renderWithHost('docs/index.html');
      await user.click(screen.getByTestId('viewer-shell-reveal-finder'));
      expect(fakeHost.fs.showItemInFolder).toHaveBeenCalledWith('/Users/me/proj/.wt/a/docs/index.html');
    });

    it('is disabled for a relative path when no workspace base is known', () => {
      renderWithHost('docs/index.html');
      expect(screen.getByTestId('viewer-shell-reveal-finder')).toBeDisabled();
    });

    it('is disabled when the daemon is remote', async () => {
      daemonIsLocal = false;
      const user = userEvent.setup();
      renderWithHost('/Users/me/Downloads/report.html');
      const btn = screen.getByTestId('viewer-shell-reveal-finder');
      expect(btn).toBeDisabled();
      await user.click(btn);
      expect(fakeHost.fs.showItemInFolder).not.toHaveBeenCalled();
    });
  });
});
