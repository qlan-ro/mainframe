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

describe('SvgViewer', () => {
  it('renders with data-testid="viewer-svg"', () => {
    render(<SvgViewer content={SAMPLE_SVG} />);
    expect(screen.getByTestId('viewer-svg')).toBeInTheDocument();
  });

  it('shows a loading placeholder when content is null', () => {
    render(<SvgViewer content={null} />);
    const root = screen.getByTestId('viewer-svg');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBeTruthy();
  });

  it('renders an img element in Preview mode', () => {
    render(<SvgViewer content={SAMPLE_SVG} />);
    const root = screen.getByTestId('viewer-svg');
    // In preview mode the viewer renders an <img> with the object URL
    const img = root.querySelector('img');
    expect(img).not.toBeNull();
  });

  it('switches to source (code) view on Source toggle click', () => {
    render(<SvgViewer content={SAMPLE_SVG} />);
    // Find the Source toggle button
    const sourceBtn = screen.getByTestId('viewer-svg-source-toggle');
    fireEvent.click(sourceBtn);
    // In source mode the raw SVG text should be visible
    expect(screen.getByTestId('viewer-svg-source')).toBeInTheDocument();
  });

  it('switches back to preview on Preview toggle click', () => {
    render(<SvgViewer content={SAMPLE_SVG} />);
    const sourceBtn = screen.getByTestId('viewer-svg-source-toggle');
    fireEvent.click(sourceBtn);
    const previewBtn = screen.getByTestId('viewer-svg-preview-toggle');
    fireEvent.click(previewBtn);
    // Back in preview mode — img is visible again
    const root = screen.getByTestId('viewer-svg');
    expect(root.querySelector('img')).not.toBeNull();
  });
});
