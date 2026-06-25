/**
 * ReferencesPanel — behavior tests.
 *
 * jsdom Range stubs needed because the test file imports from @codemirror
 * indirectly via the navigation module.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LspLocation } from '@/lib/lsp';
import { onSurfaceIntent, type SurfaceIntent } from '@/store/surface-intents';
import { ReferencesPanel } from '../references-panel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const locations: LspLocation[] = [
  {
    uri: 'file:///src/auth.ts',
    range: { start: { line: 4, character: 0 }, end: { line: 4, character: 8 } },
  },
  {
    uri: 'file:///src/middleware.ts',
    range: { start: { line: 12, character: 2 }, end: { line: 12, character: 10 } },
  },
  {
    uri: 'file:///src/utils.ts',
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReferencesPanel', () => {
  it('renders with data-testid="editor-references-panel"', () => {
    render(<ReferencesPanel locations={[]} />);
    expect(screen.getByTestId('editor-references-panel')).toBeTruthy();
  });

  it('shows "No references found." when locations is empty', () => {
    render(<ReferencesPanel locations={[]} />);
    expect(screen.getByText('No references found.')).toBeTruthy();
  });

  it('renders N rows for N locations', () => {
    render(<ReferencesPanel locations={locations} />);
    // All three rows present by filename text.
    expect(screen.getByText('auth.ts')).toBeTruthy();
    expect(screen.getByText('middleware.ts')).toBeTruthy();
    expect(screen.getByText('utils.ts')).toBeTruthy();
  });

  it('shows the location count in the header', () => {
    render(<ReferencesPanel locations={locations} />);
    expect(screen.getByText('(3)')).toBeTruthy();
  });

  it('shows the symbol name in the header when provided', () => {
    render(<ReferencesPanel locations={locations} symbolName="validate" />);
    expect(screen.getByText('References: validate')).toBeTruthy();
  });

  it('row click emits open-file surface intent', async () => {
    const user = userEvent.setup();
    const captured: SurfaceIntent[] = [];
    const unsub = onSurfaceIntent((i) => captured.push(i));

    render(<ReferencesPanel locations={locations} />);

    // Click the first row (auth.ts).
    const row = screen.getByTestId('editor-references-row-/src/auth.ts:4');
    await user.click(row);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ type: 'open-file', path: '/src/auth.ts' });
    unsub();
  });

  it('row click calls onSelectRange with the location', async () => {
    const user = userEvent.setup();
    const onSelectRange = vi.fn();

    render(<ReferencesPanel locations={locations} onSelectRange={onSelectRange} />);

    const row = screen.getByTestId('editor-references-row-/src/auth.ts:4');
    await user.click(row);

    expect(onSelectRange).toHaveBeenCalledTimes(1);
    expect(onSelectRange).toHaveBeenCalledWith(locations[0]);
  });

  it('shows close button when onClose is provided', () => {
    render(<ReferencesPanel locations={[]} onClose={() => undefined} />);
    expect(screen.getByTestId('editor-references-panel-close')).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ReferencesPanel locations={[]} onClose={onClose} />);

    await user.click(screen.getByTestId('editor-references-panel-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rows have stable data-testid keyed by path:line (not index)', () => {
    render(<ReferencesPanel locations={locations} />);
    // Stable ids regardless of render order.
    expect(screen.getByTestId('editor-references-row-/src/auth.ts:4')).toBeTruthy();
    expect(screen.getByTestId('editor-references-row-/src/middleware.ts:12')).toBeTruthy();
    expect(screen.getByTestId('editor-references-row-/src/utils.ts:1')).toBeTruthy();
  });

  it('displays 1-based line numbers', () => {
    render(<ReferencesPanel locations={[locations[0]!]} />);
    // locations[0] is line 4 (0-based) → should show :5 (1-based)
    expect(screen.getByText(':5')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Surface-intent contract: second click on different row emits correct path
// ---------------------------------------------------------------------------

describe('ReferencesPanel second-row click', () => {
  let captured: SurfaceIntent[];
  let unsub: () => void;

  beforeEach(() => {
    captured = [];
    unsub = onSurfaceIntent((i) => captured.push(i));
  });

  it('second row emits a different path', async () => {
    const user = userEvent.setup();
    render(<ReferencesPanel locations={locations} />);

    const secondRow = screen.getByTestId('editor-references-row-/src/middleware.ts:12');
    await user.click(secondRow);

    expect(captured[0]).toEqual({ type: 'open-file', path: '/src/middleware.ts' });
    unsub();
  });
});
