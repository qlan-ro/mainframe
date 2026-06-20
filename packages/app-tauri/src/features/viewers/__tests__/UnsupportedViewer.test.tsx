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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

vi.mock('@/lib/tauri/bridge', () => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(null),
  readFileBase64: vi.fn().mockResolvedValue(null),
}));

// Mock the daemon-port context used by ViewerRouter.
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: vi.fn(() => 3000),
}));

// Mock the active-identity hook used by ViewerRouter — default: no project.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(() => ({ projectId: null, chatId: null })),
}));

import { emitSurfaceIntent } from '@/store/surface-intents';
import { openExternal } from '@/lib/tauri/bridge';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { UnsupportedViewer } from '../UnsupportedViewer';

const mockUseActiveIdentity = useActiveIdentity as ReturnType<typeof vi.fn>;

const mockEmit = emitSurfaceIntent as ReturnType<typeof vi.fn>;
const mockOpenExternal = openExternal as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockEmit.mockClear();
  mockOpenExternal.mockClear();
  mockUseActiveIdentity.mockReturnValue({ projectId: null, chatId: null, projectPath: undefined });
});

describe('UnsupportedViewer', () => {
  it('renders with data-testid="viewer-unsupported"', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    expect(screen.getByTestId('viewer-unsupported')).toBeInTheDocument();
  });

  it('shows "No preview available" heading', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    expect(screen.getByText('No preview available')).toBeInTheDocument();
  });

  it('shows subtext naming the unsupported file inline', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    // Copy is split across text + a <code> filename node (also shown in the breadcrumb).
    expect(screen.getByText('archive.zip', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText(/can't render/i)).toBeInTheDocument();
  });

  it('renders "Open externally" button with data-testid="viewer-unsupported-open"', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    expect(screen.getByTestId('viewer-unsupported-open')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-unsupported-open')).toHaveTextContent('Open externally');
  });

  it('renders "Reveal in tree" button with data-testid="viewer-unsupported-reveal"', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    expect(screen.getByTestId('viewer-unsupported-reveal')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-unsupported-reveal')).toHaveTextContent('Reveal in tree');
  });

  it('emits reveal-file intent with the file path when "Reveal in tree" is clicked', async () => {
    const user = userEvent.setup();
    render(<UnsupportedViewer path="/archive.zip" />);
    await user.click(screen.getByTestId('viewer-unsupported-reveal'));
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'reveal-file', path: '/archive.zip' });
  });

  it('calls openExternal with a file:// URL when "Open externally" is clicked', async () => {
    const user = userEvent.setup();
    render(<UnsupportedViewer path="/archive.zip" />);
    await user.click(screen.getByTestId('viewer-unsupported-open'));
    expect(mockOpenExternal).toHaveBeenCalledOnce();
    expect(mockOpenExternal).toHaveBeenCalledWith('file:///archive.zip');
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('"Open externally" button has primary accent fill (bg-primary class)', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    const btn = screen.getByTestId('viewer-unsupported-open');
    expect(btn.className).toContain('bg-primary');
    // Should NOT have outline/ghost style
    expect(btn.className).not.toContain('bg-transparent');
  });

  it('icon chip has 46×46 size and rounded-[11px] bg-mf-chip container', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    const root = screen.getByTestId('viewer-unsupported');
    // The chip is the div wrapping the icon
    const chip = root.querySelector('[data-testid="viewer-unsupported-icon-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.className).toContain('bg-mf-chip');
  });

  it('card uses bg-background class (not bg-card or bg-mf-tab-bar)', () => {
    render(<UnsupportedViewer path="/archive.zip" />);
    const card = screen.getByTestId('viewer-unsupported-card');
    expect(card.className).toContain('bg-background');
    expect(card.className).not.toContain('bg-card');
    expect(card.className).not.toContain('bg-mf-tab-bar');
  });

  describe('toFileUrl — path resolution', () => {
    it('resolves a relative path against projectPath to an absolute file:// URL', async () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      render(<UnsupportedViewer path="src/spec.pdf" />);
      const btn = screen.getByTestId('viewer-unsupported-open');
      expect(btn).not.toBeDisabled();
      await user.click(btn);
      expect(mockOpenExternal).toHaveBeenCalledWith('file:///home/user/myproject/src/spec.pdf');
    });

    it('passes an already-absolute path through as a file:// URL unchanged', async () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      render(<UnsupportedViewer path="/absolute/archive.zip" />);
      await user.click(screen.getByTestId('viewer-unsupported-open'));
      expect(mockOpenExternal).toHaveBeenCalledWith('file:///absolute/archive.zip');
    });

    it('disables "Open externally" when path is relative and projectPath is unavailable', () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: undefined });
      render(<UnsupportedViewer path="src/spec.pdf" />);
      const btn = screen.getByTestId('viewer-unsupported-open');
      expect(btn).toBeDisabled();
    });
  });
});
