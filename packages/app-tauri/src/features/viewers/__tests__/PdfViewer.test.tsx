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
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('PdfViewer', () => {
  it('renders with data-testid="viewer-pdf"', () => {
    render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" />);
    expect(screen.getByTestId('viewer-pdf')).toBeInTheDocument();
  });

  it('shows a loading placeholder when base64 is null', () => {
    render(<PdfViewer base64={null} mimeType="application/pdf" />);
    const root = screen.getByTestId('viewer-pdf');
    expect(root.querySelector('embed')).toBeNull();
    expect(root.textContent).toBeTruthy();
  });

  it('renders the "open externally" fallback link', () => {
    render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" path="/docs/spec.pdf" />);
    expect(screen.getByTestId('viewer-pdf-fallback')).toBeInTheDocument();
  });

  it('shows the PDF embed when base64 is provided', () => {
    render(<PdfViewer base64={FAKE_PDF_B64} mimeType="application/pdf" />);
    const root = screen.getByTestId('viewer-pdf');
    // The embed element is rendered for inline display
    const embed = root.querySelector('embed');
    expect(embed).not.toBeNull();
  });
});
