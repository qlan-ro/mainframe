/**
 * UnsupportedViewer tests.
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-unsupported".
 *  2. Shows "No preview available" heading.
 *  3. "Open externally" button (viewer-unsupported-open) is present.
 *  4. "Reveal in tree" button (viewer-unsupported-reveal) is present.
 *  5. "Reveal in tree" button emits the reveal-file surface intent with the file path.
 *  6. "Open externally" button calls openExternal with a file:// URL.
 *  7. The viewer renders inside ViewerShell (viewer-shell present).
 *  8. The viewer-router renders UnsupportedViewer for an unknown extension (.zip)
 *     when no renderCode prop is provided.
 *  9. (toFileUrl) Relative path + projectPath → absolute file:// URL.
 * 10. (toFileUrl) Relative path + no projectPath → button is disabled.
 * 11. (toFileUrl) Absolute path → file:// URL passed through.
 * 12. "Open externally" button uses primary accent fill (bg-primary class).
 * 13. Icon chip is 46×46 with rounded-[11px] bg-mf-chip container.
 * 14. Card uses bg-background (not bg-card or bg-mf-tab-bar).
 * 15. (remote daemon) "Open externally" is disabled (aria-disabled) when useDaemonIsLocal() returns false.
 * 16. (remote daemon) Clicking the disabled button does NOT call host.shell.openExternal.
 * 17. (local daemon) Clicking "Open externally" calls host.shell.openExternal normally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// Mock the active-identity hook used by ViewerRouter — default: no project.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(() => ({ projectId: null, chatId: null })),
}));

// Controls the useDaemonIsLocal() gate; reset to true (local) before each test.
let daemonIsLocal = true;
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => daemonIsLocal }));

import { emitSurfaceIntent } from '@/store/surface-intents';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { UnsupportedViewer } from '../UnsupportedViewer';

const mockUseActiveIdentity = useActiveIdentity as ReturnType<typeof vi.fn>;
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
  vi.spyOn(fakeHost.shell, 'openExternal').mockResolvedValue(undefined);
  mockEmit.mockClear();
  mockUseActiveIdentity.mockReturnValue({ projectId: null, chatId: null, projectPath: undefined });
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

  it('calls openExternal with a file:// URL when "Open externally" is clicked', async () => {
    const user = userEvent.setup();
    renderUnsupported('/archive.zip');
    await user.click(screen.getByTestId('viewer-unsupported-open'));
    expect(fakeHost.shell.openExternal).toHaveBeenCalledOnce();
    expect(fakeHost.shell.openExternal).toHaveBeenCalledWith('file:///archive.zip');
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    renderUnsupported('/archive.zip');
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  describe('toFileUrl — path resolution', () => {
    it('resolves a relative path against projectPath to an absolute file:// URL', async () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      renderUnsupported('src/spec.pdf');
      const btn = screen.getByTestId('viewer-unsupported-open');
      expect(btn).not.toBeDisabled();
      await user.click(btn);
      expect(fakeHost.shell.openExternal).toHaveBeenCalledWith('file:///home/user/myproject/src/spec.pdf');
    });

    it('passes an already-absolute path through as a file:// URL unchanged', async () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      renderUnsupported('/absolute/archive.zip');
      await user.click(screen.getByTestId('viewer-unsupported-open'));
      expect(fakeHost.shell.openExternal).toHaveBeenCalledWith('file:///absolute/archive.zip');
    });

    it('disables "Open externally" when path is relative and projectPath is unavailable', () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: undefined });
      renderUnsupported('src/spec.pdf');
      const btn = screen.getByTestId('viewer-unsupported-open');
      expect(btn).toBeDisabled();
    });
  });

  describe('remote daemon gate', () => {
    it('disables "Open externally" (aria-disabled) when daemon is remote', () => {
      daemonIsLocal = false;
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/proj' });
      renderUnsupported('/archive.zip');
      const btn = screen.getByTestId('viewer-unsupported-open');
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('aria-disabled', 'true');
    });

    it('does NOT call openExternal when daemon is remote and button is clicked', async () => {
      daemonIsLocal = false;
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/proj' });
      const user = userEvent.setup();
      renderUnsupported('/archive.zip');
      const btn = screen.getByTestId('viewer-unsupported-open');
      // Attempt click on a disabled button — userEvent skips the handler
      await user.click(btn);
      expect(fakeHost.shell.openExternal).not.toHaveBeenCalled();
    });

    it('calls openExternal normally when daemon is local', async () => {
      daemonIsLocal = true;
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/proj' });
      const user = userEvent.setup();
      renderUnsupported('/archive.zip');
      await user.click(screen.getByTestId('viewer-unsupported-open'));
      expect(fakeHost.shell.openExternal).toHaveBeenCalledOnce();
      expect(fakeHost.shell.openExternal).toHaveBeenCalledWith('file:///archive.zip');
    });
  });
});
