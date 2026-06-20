/**
 * SvgViewer tests.
 *
 * Strategy: pass raw SVG text. The viewer renders it via an object URL
 * (URL.createObjectURL stub below) so we avoid dangerouslySetInnerHTML.
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-svg".
 *  2. Renders an <img> (or <object>) tag pointing at the object URL.
 *  3. Shows a loading placeholder when content is null.
 *  4. Preview/Source toggle switches views.
 *  5. Renders inside ViewerShell (viewer-shell present).
 *  6. Footer status (viewer-shell-status) contains SVG metadata.
 *  7. Active toggle is the raised bg-background segment (not bg-accent).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SvgViewer } from '../SvgViewer';

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

// jsdom does not implement URL.createObjectURL; stub it.
beforeAll(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock-svg-url'),
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

describe('SvgViewer', () => {
  it('renders with data-testid="viewer-svg"', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    expect(screen.getByTestId('viewer-svg')).toBeInTheDocument();
  });

  it('shows a loading placeholder when content is null', () => {
    render(<SvgViewer content={null} path="/a/b/icon.svg" />);
    const root = screen.getByTestId('viewer-svg');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBeTruthy();
  });

  it('renders an img element in Preview mode', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const root = screen.getByTestId('viewer-svg');
    // In preview mode the viewer renders an <img> with the object URL
    const img = root.querySelector('img');
    expect(img).not.toBeNull();
  });

  it('switches to source (code) view on Code toggle click', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    // The second toggle is now labelled "Code" (renamed from "Source")
    const sourceBtn = screen.getByTestId('viewer-svg-source-toggle');
    expect(sourceBtn.textContent).toBe('Code');
    fireEvent.click(sourceBtn);
    // In source mode the raw SVG text should be visible
    expect(screen.getByTestId('viewer-svg-source')).toBeInTheDocument();
  });

  it('switches back to preview on Preview toggle click', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const sourceBtn = screen.getByTestId('viewer-svg-source-toggle');
    fireEvent.click(sourceBtn);
    const previewBtn = screen.getByTestId('viewer-svg-preview-toggle');
    fireEvent.click(previewBtn);
    // Back in preview mode — img is visible again
    const root = screen.getByTestId('viewer-svg');
    expect(root.querySelector('img')).not.toBeNull();
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('shows SVG status in the viewer-shell-status footer', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const status = screen.getByTestId('viewer-shell-status');
    expect(status.textContent).toMatch(/SVG/);
  });

  it('statusRight slot shows dimensions and size when SVG metadata is available', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const shell = screen.getByTestId('viewer-shell');
    const footer = shell.lastElementChild as HTMLElement;
    // SAMPLE_SVG has viewBox 0 0 10 10 → right should contain 10×10
    expect(footer.textContent).toMatch(/10×10/);
  });

  it('active toggle is the raised bg-background segment, not bg-accent', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const previewBtn = screen.getByTestId('viewer-svg-preview-toggle');
    expect(previewBtn.className).toContain('bg-background');
    expect(previewBtn.className).not.toContain('bg-accent');
  });

  it('source view uses the code surface (bg-mf-code-bg + code foreground)', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    fireEvent.click(screen.getByTestId('viewer-svg-source-toggle'));
    const pre = screen.getByTestId('viewer-svg-source');
    expect(pre.className).toContain('bg-mf-code-bg');
    expect(pre.className).toContain('text-mf-code-fg');
  });

  it('preview mode shows the SVG inside a raised rounded card (not bare on the checkerboard)', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const img = screen.getByTestId('viewer-svg').querySelector('img');
    const card = img?.parentElement;
    expect(card?.className).toMatch(/rounded-/);
    expect(card?.className).toMatch(/shadow-/);
  });
});
