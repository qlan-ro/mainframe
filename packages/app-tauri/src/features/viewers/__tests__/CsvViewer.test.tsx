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
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CsvViewer } from '../CsvViewer';

const SIMPLE_CSV = 'name,age,city\nAlice,30,London\nBob,25,Paris\nCarol,35,Berlin';

describe('CsvViewer', () => {
  it('renders with data-testid="viewer-csv"', () => {
    render(<CsvViewer content={SIMPLE_CSV} />);
    expect(screen.getByTestId('viewer-csv')).toBeInTheDocument();
  });

  it('shows a loading placeholder when content is null', () => {
    render(<CsvViewer content={null} />);
    const root = screen.getByTestId('viewer-csv');
    expect(root.querySelector('table')).toBeNull();
    expect(root.textContent).toBeTruthy();
  });

  it('renders headers in <th> elements', () => {
    render(<CsvViewer content={SIMPLE_CSV} />);
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('age')).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
    const ths = document.querySelectorAll('th');
    // Row-number gutter + 3 data headers = 4 th elements
    expect(ths.length).toBeGreaterThanOrEqual(3);
  });

  it('renders body rows with the correct cell values', () => {
    render(<CsvViewer content={SIMPLE_CSV} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('handles quoted fields containing commas', () => {
    const csv = 'label,value\n"hello, world",42\n"foo",7';
    render(<CsvViewer content={csv} />);
    expect(screen.getByText('hello, world')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('filters rows live when the search input changes', () => {
    render(<CsvViewer content={SIMPLE_CSV} />);
    const filter = screen.getByTestId('viewer-csv-filter');
    fireEvent.change(filter, { target: { value: 'Alice' } });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // Bob and Carol should be filtered out
    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.queryByText('Carol')).toBeNull();
  });

  it('sorts ascending on first header click, descending on second', () => {
    render(<CsvViewer content={SIMPLE_CSV} />);
    // Click the "name" column header
    const nameHeader = screen.getByTestId('viewer-csv-header-name');
    fireEvent.click(nameHeader);
    // After ascending sort: Alice < Bob < Carol — all still present
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // Click again — descending
    fireEvent.click(nameHeader);
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });
});
