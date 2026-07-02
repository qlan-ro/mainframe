/**
 * CsvViewer tests.
 *
 * Strategy: pass raw CSV text; verify the table structure.
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-csv".
 *  2. Parses headers from the first row; each header is in a <th>.
 *  3. Parses body rows; cell values appear in <td> elements.
 *  4. Handles quoted fields containing commas.
 *  5. Shows a loading placeholder when content is null.
 *  6. Filters rows live when the search input changes.
 *  7. Sorts ascending/descending on header click.
 *  8. No duplicate-key React warnings on duplicate column headers.
 *  9. Row identity is stable under sort (keyed off parsed-row index, not sorted index).
 * 10. Renders inside ViewerShell (viewer-shell present).
 * 11. Footer status (viewer-shell-status) contains CSV type ("CSV").
 * 12. Footer statusRight (viewer-shell-status-right) contains row/col counts.
 * 13. Filter input lives in the ViewerShell actions (header), not a separate sub-bar.
 * 14. Sort arrows use accent-colored ▲/▼ spans (not plain text ↑/↓).
 * 15. Sticky thead uses bg-mf-content2, not bg-background.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CsvViewer } from '../CsvViewer';

const SIMPLE_CSV = 'name,age,city\nAlice,30,London\nBob,25,Paris\nCarol,35,Berlin';

// CSV with two identical column headers — triggers duplicate-key bug on <th key={header}>
const DUPLICATE_HEADER_CSV = 'value,value,value\n1,2,3\n4,5,6';

// CSV for stable-key sort test
const SORT_CSV = 'name,score\nZoe,10\nAbe,20';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Spy on console.error to catch React duplicate-key warnings
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// Mock surface-intents so ViewerShell's reveal button doesn't crash.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

describe('CsvViewer', () => {
  it('renders with data-testid="viewer-csv"', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    expect(screen.getByTestId('viewer-csv')).toBeInTheDocument();
  });

  it('shows a loading placeholder when content is null', () => {
    render(<CsvViewer content={null} path="/data/table.csv" />);
    const root = screen.getByTestId('viewer-csv');
    expect(root.querySelector('table')).toBeNull();
    expect(root.textContent).toBeTruthy();
  });

  it('renders headers in <th> elements', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('age')).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
    const ths = document.querySelectorAll('th');
    // Row-number gutter + 3 data headers = 4 th elements
    expect(ths.length).toBeGreaterThanOrEqual(3);
  });

  it('renders body rows with the correct cell values', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('handles quoted fields containing commas', () => {
    const csv = 'label,value\n"hello, world",42\n"foo",7';
    render(<CsvViewer content={csv} path="/data/table.csv" />);
    expect(screen.getByText('hello, world')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('filters rows live when the search input changes', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    const filter = screen.getByTestId('viewer-csv-filter');
    fireEvent.change(filter, { target: { value: 'Alice' } });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // Bob and Carol should be filtered out
    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.queryByText('Carol')).toBeNull();
  });

  it('sorts ascending on first header click, descending on second', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    // Click the "name" column header
    const nameHeader = screen.getByTestId('viewer-csv-header-name');
    fireEvent.click(nameHeader);
    // After ascending sort: Alice < Bob < Carol — all still present
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // Click again — descending
    fireEvent.click(nameHeader);
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('does not emit a React duplicate-key warning for headers with the same name', () => {
    render(<CsvViewer content={DUPLICATE_HEADER_CSV} path="/data/table.csv" />);
    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('same key'),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it('does not emit a React duplicate-key warning for rows with same header names after sort', () => {
    render(<CsvViewer content={DUPLICATE_HEADER_CSV} path="/data/table.csv" />);
    // Click to sort on first "value" column
    const headers = document.querySelectorAll('th');
    // headers[0] is the row-number gutter; headers[1] is the first "value" column
    fireEvent.click(headers[1]!);
    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('same key'),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it('preserves row identity after sorting (stable parsed-row index keys)', () => {
    render(<CsvViewer content={SORT_CSV} path="/data/table.csv" />);
    // Before sort: Zoe is row 1, Abe is row 2
    const tbody = document.querySelector('tbody')!;
    const rowsBefore = Array.from(tbody.querySelectorAll('tr'));
    expect(rowsBefore[0]!.textContent).toContain('Zoe');
    expect(rowsBefore[1]!.textContent).toContain('Abe');

    // Click "name" header to sort ascending — Abe should come first
    const nameHeader = screen.getByTestId('viewer-csv-header-name');
    fireEvent.click(nameHeader);

    const rowsAfter = Array.from(tbody.querySelectorAll('tr'));
    expect(rowsAfter[0]!.textContent).toContain('Abe');
    expect(rowsAfter[1]!.textContent).toContain('Zoe');

    // No duplicate-key warnings
    const keyWarnings = consoleErrorSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('same key'),
    );
    expect(keyWarnings).toHaveLength(0);
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('shows CSV type label in the viewer-shell-status footer', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    const status = screen.getByTestId('viewer-shell-status');
    expect(status.textContent).toMatch(/CSV/);
  });

  it('shows row/col metadata in the statusRight slot of ViewerShell footer', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    // SIMPLE_CSV has 3 data rows and 3 columns — must appear right-aligned in footer
    // The ViewerShell footer renders status (left) and statusRight (right) as separate spans.
    // We query the footer div (last child of viewer-shell) and check its full text.
    const shell = screen.getByTestId('viewer-shell');
    const footer = shell.lastElementChild as HTMLElement;
    expect(footer.textContent).toMatch(/3 rows/);
    expect(footer.textContent).toMatch(/3 cols/);
  });

  it('filter input is inside the ViewerShell header (actions slot), not a separate sub-bar', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    const shell = screen.getByTestId('viewer-shell');
    const header = shell.children[0] as HTMLElement; // first child = header div
    const filterInput = header.querySelector('[data-testid="viewer-csv-filter"]');
    expect(filterInput).not.toBeNull();
  });

  it('sort arrows use accent-colored ▲/▼ spans, not plain ↑/↓ text', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    const nameHeader = screen.getByTestId('viewer-csv-header-name');
    // Click to sort ascending
    fireEvent.click(nameHeader);
    // ▲ should appear as a span with text-primary class
    const arrowSpan = nameHeader.querySelector('.text-primary');
    expect(arrowSpan).not.toBeNull();
    expect(arrowSpan?.textContent).toBe('▲');

    // Click again for descending
    fireEvent.click(nameHeader);
    const arrowSpanDesc = nameHeader.querySelector('.text-primary');
    expect(arrowSpanDesc).not.toBeNull();
    expect(arrowSpanDesc?.textContent).toBe('▼');
  });

  it('sticky thead has bg-mf-content2 class (not bg-background)', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    const thead = document.querySelector('thead');
    expect(thead).not.toBeNull();
    expect(thead?.className).toContain('bg-mf-content2');
    expect(thead?.className).not.toContain('bg-background');
  });

  it('filter chip is 20px tall with rounded-sm (6px), not the compressed h-5/rounded-md', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    const chip = screen.getByTestId('viewer-csv-filter').parentElement as HTMLElement;
    expect(chip.className).toContain('h-[20px]');
    expect(chip.className).toContain('rounded-sm');
    expect(chip.className).not.toContain('rounded-md');
  });

  it('odd zebra rows use bg-mf-code-bg (design #fbfaf7 tint), not bg-card', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    const tbody = document.querySelector('tbody')!;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    expect(rows[1]!.className).toContain('bg-mf-code-bg');
    expect(rows[1]!.className).not.toContain('bg-card');
  });

  it('active sort header shows a decorative ChevronsUpDown icon alongside the ▲/▼ arrow', () => {
    render(<CsvViewer content={SIMPLE_CSV} path="/data/table.csv" />);
    const nameHeader = screen.getByTestId('viewer-csv-header-name');
    fireEvent.click(nameHeader);
    const svg = nameHeader.querySelector('svg.lucide-chevrons-up-down');
    expect(svg).not.toBeNull();
  });
});
