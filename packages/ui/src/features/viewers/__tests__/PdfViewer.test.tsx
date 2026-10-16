/**
 * PdfViewer tests.
 *
 * The PDF viewer uses <embed> with an object URL derived from base64 bytes.
 * jsdom doesn't implement URL.createObjectURL; stub it.
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-pdf".
 *  2. Shows a loading placeholder when base64 is null.
 *  3. Renders the "open externally" fallback (always shown alongside the embed
 *     so users can escape if the in-app render fails).
 *  4. In non-Tauri (browser dev) mode, renders the graceful "open externally"
 *     fallback with data-testid="viewer-pdf-fallback".
 *  5. Renders inside ViewerShell (viewer-shell present).
 *  6. Footer status (viewer-shell-status) shows PDF metadata.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { PdfViewer } from '../PdfViewer';

// Minimal valid PDF base64 (not a real renderable PDF — just enough bytes to
// satisfy the component's "has content" check).
const FAKE_PDF_B64 = 'JVBERi0xLjQ='; // "%PDF-1.4" in base64

beforeAll(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock-pdf-url'),
    revokeObjectURL: vi.fn(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Mock surface-intents so ViewerShell's reveal button doesn't crash.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => true }));

/** Every viewer/preview surface here renders v2 `Hint`s, which need the v2 TooltipProvider. */
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

let fakeHost: FakeHostBridge;

function renderPdf(props: { base64: string | null; mimeType: string; path: string }) {
  return render(
    <HostProvider host={fakeHost}>
      <PdfViewer {...props} />
    </HostProvider>,
  );
}

beforeEach(() => {
  fakeHost = new FakeHostBridge();
  vi.spyOn(fakeHost.fs, 'openPath').mockResolvedValue(undefined);
});

describe('PdfViewer', () => {
  it('renders with data-testid="viewer-pdf"', () => {
    renderPdf({ base64: FAKE_PDF_B64, mimeType: 'application/pdf', path: '/docs/spec.pdf' });
    expect(screen.getByTestId('viewer-pdf')).toBeInTheDocument();
  });

  it('shows a loading placeholder when base64 is null', () => {
    renderPdf({ base64: null, mimeType: 'application/pdf', path: '/docs/spec.pdf' });
    const root = screen.getByTestId('viewer-pdf');
    expect(root.querySelector('embed')).toBeNull();
    expect(root.textContent).toBeTruthy();
  });

  it('renders the "open externally" fallback link', () => {
    renderPdf({ base64: FAKE_PDF_B64, mimeType: 'application/pdf', path: '/docs/spec.pdf' });
    expect(screen.getByTestId('viewer-pdf-fallback')).toBeInTheDocument();
  });

  it('shows the PDF embed when base64 is provided', () => {
    renderPdf({ base64: FAKE_PDF_B64, mimeType: 'application/pdf', path: '/docs/spec.pdf' });
    const root = screen.getByTestId('viewer-pdf');
    // The embed element is rendered for inline display
    const embed = root.querySelector('embed');
    expect(embed).not.toBeNull();
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    renderPdf({ base64: FAKE_PDF_B64, mimeType: 'application/pdf', path: '/docs/spec.pdf' });
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('shows PDF status in the viewer-shell-status footer', () => {
    renderPdf({ base64: FAKE_PDF_B64, mimeType: 'application/pdf', path: '/docs/spec.pdf' });
    const status = screen.getByTestId('viewer-shell-status');
    expect(status.textContent).toMatch(/PDF/);
  });

  it('opens the PDF with its default app from the "Open externally" button', async () => {
    const user = userEvent.setup();
    renderPdf({ base64: FAKE_PDF_B64, mimeType: 'application/pdf', path: '/docs/spec.pdf' });
    await user.click(screen.getByTestId('viewer-pdf-fallback'));
    expect(fakeHost.fs.openPath).toHaveBeenCalledWith('/docs/spec.pdf');
  });

  // Path resolution (relative paths, worktree precedence, absolute passthrough,
  // disabled without a base) is covered once in UnsupportedViewer.test.tsx —
  // both viewers share useNativeFileAction.
});
