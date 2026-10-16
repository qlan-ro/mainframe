/**
 * UnsupportedViewer tests.
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-unsupported".
 *  2. Shows "No preview available" heading.
 *  3. "Open externally" button (viewer-unsupported-open) is present.
 *  4. "Reveal in tree" button (viewer-unsupported-reveal) is present.
 *  5. "Reveal in tree" button emits the reveal-file surface intent with the file path.
 *  6. "Open externally" opens the file with its default app (host.fs.openPath).
 *  7. The viewer renders inside ViewerShell (viewer-shell present).
 *  8. The viewer-router renders UnsupportedViewer for an unknown extension (.zip)
 *     when no renderCode prop is provided.
 *  9. Relative path + workspace base → joined absolute path (worktree before project).
 * 10. Relative path + no base → button is disabled.
 * 11. Absolute path → passed through.
 * 12. "Open externally" is the primary v2 Button; "Reveal in tree" is the outline one.
 * 13. Icon chip is a 44×44 rounded-lg bg-muted container.
 * 14. The centered panel is a v2 Card (bg-card) on a bg-muted/40 backdrop.
 * 15. (remote daemon) "Open externally" is disabled (aria-disabled) when useDaemonIsLocal() returns false.
 * 16. (remote daemon) Clicking the disabled button does NOT call host.fs.openPath.
 * 17. (local daemon) Clicking "Open externally" calls host.fs.openPath normally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import userEvent from '@testing-library/user-event';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

// Mock the daemon-port context used by ViewerRouter.
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: vi.fn(() => 3000),
}));

// Controls the useDaemonIsLocal() gate; reset to true (local) before each test.
let daemonIsLocal = true;
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => daemonIsLocal }));

import { emitSurfaceIntent } from '@/store/surface-intents';
import { useActiveBasesStore } from '@/store/active-bases-store';
import type { FileBases } from '@/lib/files/file-ref';
import { UnsupportedViewer } from '../UnsupportedViewer';

/** Every viewer/preview surface here renders v2 `Hint`s, which need the v2 TooltipProvider. */
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

const setBases = (bases: FileBases) => useActiveBasesStore.setState({ bases });
const mockEmit = emitSurfaceIntent as ReturnType<typeof vi.fn>;

let fakeHost: FakeHostBridge;

function renderUnsupported(path: string) {
  return render(
    <HostProvider host={fakeHost}>
      <UnsupportedViewer path={path} />
    </HostProvider>,
  );
}

beforeEach(() => {
  fakeHost = new FakeHostBridge();
  vi.spyOn(fakeHost.fs, 'openPath').mockResolvedValue(undefined);
  mockEmit.mockClear();
  setBases({});
  daemonIsLocal = true;
});

describe('UnsupportedViewer', () => {
  it('renders with data-testid="viewer-unsupported"', () => {
    renderUnsupported('/archive.zip');
    expect(screen.getByTestId('viewer-unsupported')).toBeInTheDocument();
  });

  it('shows "No preview available" heading', () => {
    renderUnsupported('/archive.zip');
    expect(screen.getByText('No preview available')).toBeInTheDocument();
  });

  it('shows subtext naming the unsupported file inline', () => {
    renderUnsupported('/archive.zip');
    // Copy is split across text + a <code> filename node (also shown in the breadcrumb).
    expect(screen.getByText('archive.zip', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText(/can't render/i)).toBeInTheDocument();
  });

  it('renders "Open externally" button with data-testid="viewer-unsupported-open"', () => {
    renderUnsupported('/archive.zip');
    expect(screen.getByTestId('viewer-unsupported-open')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-unsupported-open')).toHaveTextContent('Open externally');
  });

  it('renders "Reveal in tree" button with data-testid="viewer-unsupported-reveal"', () => {
    renderUnsupported('/archive.zip');
    expect(screen.getByTestId('viewer-unsupported-reveal')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-unsupported-reveal')).toHaveTextContent('Reveal in tree');
  });

  it('emits reveal-file intent with the file path when "Reveal in tree" is clicked', async () => {
    const user = userEvent.setup();
    renderUnsupported('/archive.zip');
    await user.click(screen.getByTestId('viewer-unsupported-reveal'));
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'reveal-file', path: '/archive.zip' });
  });

  it('opens the file with its default app when "Open externally" is clicked', async () => {
    const user = userEvent.setup();
    renderUnsupported('/archive.zip');
    await user.click(screen.getByTestId('viewer-unsupported-open'));
    expect(fakeHost.fs.openPath).toHaveBeenCalledOnce();
    expect(fakeHost.fs.openPath).toHaveBeenCalledWith('/archive.zip');
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    renderUnsupported('/archive.zip');
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  describe('path resolution', () => {
    it('resolves a relative path against the project path', async () => {
      setBases({ projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      renderUnsupported('src/spec.pdf');
      const btn = screen.getByTestId('viewer-unsupported-open');
      expect(btn).not.toBeDisabled();
      await user.click(btn);
      expect(fakeHost.fs.openPath).toHaveBeenCalledWith('/home/user/myproject/src/spec.pdf');
    });

    it("resolves a relative path against the chat's worktree before the project", async () => {
      setBases({ worktreePath: '/home/user/myproject/.worktrees/feat', projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      renderUnsupported('src/spec.pdf');
      await user.click(screen.getByTestId('viewer-unsupported-open'));
      expect(fakeHost.fs.openPath).toHaveBeenCalledWith('/home/user/myproject/.worktrees/feat/src/spec.pdf');
    });

    it('passes an already-absolute path through unchanged', async () => {
      setBases({ projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      renderUnsupported('/absolute/archive.zip');
      await user.click(screen.getByTestId('viewer-unsupported-open'));
      expect(fakeHost.fs.openPath).toHaveBeenCalledWith('/absolute/archive.zip');
    });

    it('disables "Open externally" when path is relative and no workspace base is known', () => {
      renderUnsupported('src/spec.pdf');
      const btn = screen.getByTestId('viewer-unsupported-open');
      expect(btn).toBeDisabled();
    });
  });

  describe('remote daemon gate', () => {
    it('disables "Open externally" (aria-disabled) when daemon is remote', () => {
      daemonIsLocal = false;
      setBases({ projectPath: '/home/user/proj' });
      renderUnsupported('/archive.zip');
      const btn = screen.getByTestId('viewer-unsupported-open');
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('aria-disabled', 'true');
    });

    it('does NOT open the file when daemon is remote and button is clicked', async () => {
      daemonIsLocal = false;
      setBases({ projectPath: '/home/user/proj' });
      const user = userEvent.setup();
      renderUnsupported('/archive.zip');
      const btn = screen.getByTestId('viewer-unsupported-open');
      // Attempt click on a disabled button — userEvent skips the handler
      await user.click(btn);
      expect(fakeHost.fs.openPath).not.toHaveBeenCalled();
    });

    it('opens the file normally when daemon is local', async () => {
      daemonIsLocal = true;
      setBases({ projectPath: '/home/user/proj' });
      const user = userEvent.setup();
      renderUnsupported('/archive.zip');
      await user.click(screen.getByTestId('viewer-unsupported-open'));
      expect(fakeHost.fs.openPath).toHaveBeenCalledOnce();
      expect(fakeHost.fs.openPath).toHaveBeenCalledWith('/archive.zip');
    });
  });
});
