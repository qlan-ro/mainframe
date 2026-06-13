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
 *  7. (toFileUrl) Relative path + projectPath → absolute file:// URL.
 *  8. (toFileUrl) Absolute path → file:// URL passed through unchanged.
 *  9. (toFileUrl) Relative path + no projectPath → button is disabled.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// Mock the tauri bridge (openExternal).
vi.mock('@/lib/tauri/bridge', () => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));

// Mock the active-identity hook — default: no project.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(() => ({ projectPath: undefined })),
}));

import { openExternal } from '@/lib/tauri/bridge';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';

const mockOpenExternal = openExternal as ReturnType<typeof vi.fn>;
const mockUseActiveIdentity = useActiveIdentity as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockOpenExternal.mockClear();
  mockUseActiveIdentity.mockReturnValue({ projectPath: undefined });
});

describe('PdfViewer', () => {
  it('renders with data-testid="viewer-pdf"', () => {
    render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="/docs/spec.pdf" />);
    expect(screen.getByTestId('viewer-pdf')).toBeInTheDocument();
  });

  it('shows a loading placeholder when base64 is null', () => {
    render(<PdfViewer base64={null} mimeType="application/pdf" path="/docs/spec.pdf" />);
    const root = screen.getByTestId('viewer-pdf');
    expect(root.querySelector('embed')).toBeNull();
    expect(root.textContent).toBeTruthy();
  });

  it('renders the "open externally" fallback link', () => {
    render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="/docs/spec.pdf" />);
    expect(screen.getByTestId('viewer-pdf-fallback')).toBeInTheDocument();
  });

  it('shows the PDF embed when base64 is provided', () => {
    render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="/docs/spec.pdf" />);
    const root = screen.getByTestId('viewer-pdf');
    // The embed element is rendered for inline display
    const embed = root.querySelector('embed');
    expect(embed).not.toBeNull();
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="/docs/spec.pdf" />);
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('shows PDF status in the viewer-shell-status footer', () => {
    render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="/docs/spec.pdf" />);
    const status = screen.getByTestId('viewer-shell-status');
    expect(status.textContent).toMatch(/PDF/);
  });

  describe('toFileUrl — path resolution', () => {
    it('resolves a relative path against projectPath to an absolute file:// URL', async () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="src/spec.pdf" />);
      const btn = screen.getByTestId('viewer-pdf-fallback');
      expect(btn).not.toBeDisabled();
      await user.click(btn);
      expect(mockOpenExternal).toHaveBeenCalledWith('file:///home/user/myproject/src/spec.pdf');
    });

    it('passes an already-absolute path through as a file:// URL unchanged', async () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: '/home/user/myproject' });
      const user = userEvent.setup();
      render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="/docs/spec.pdf" />);
      await user.click(screen.getByTestId('viewer-pdf-fallback'));
      expect(mockOpenExternal).toHaveBeenCalledWith('file:///docs/spec.pdf');
    });

    it('disables "Open externally" when path is relative and projectPath is unavailable', () => {
      mockUseActiveIdentity.mockReturnValue({ projectPath: undefined });
      render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="src/spec.pdf" />);
      expect(screen.getByTestId('viewer-pdf-fallback')).toBeDisabled();
    });
  });
});
