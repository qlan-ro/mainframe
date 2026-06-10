/**
 * CodeRefCard — behavior tests.
 *
 * Strategy:
 *  - Pure props component; no context mocking needed.
 *  - All expected values are hardcoded — no logic is recomputed from the
 *    component's own formula.
 *
 * Behaviors covered:
 *  H1 — 5-line snippet: header shows file name, en-dash range label, line count;
 *        body rows are numbered starting at range.start; no expand button.
 *  H2 — Single-line snippet (no end): range label has no dash; no expand button.
 *  H3 — range.end === range.start: range label has no dash.
 *  H4 — 12-line snippet: initially 7 rows shown; expand button "Show all 12 lines"
 *        present; clicking shows all 12 rows and changes label to "Collapse";
 *        clicking again restores 7 rows and "Show all 12 lines".
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeRefCard } from '../CodeRefCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function queryExpandButton() {
  return screen.queryByTestId('chat-user-code-ref-expand');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodeRefCard', () => {
  describe('H1 — 5-line snippet with start/end range', () => {
    it('renders the file name in the header', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Layout.tsx',
            range: { start: 42, end: 46 },
            code: 'a\nb\nc\nd\ne',
          }}
        />,
      );
      expect(screen.getByTestId('chat-user-code-ref')).toBeTruthy();
      expect(screen.getByText('Layout.tsx')).toBeTruthy();
    });

    it('renders the en-dash range label L42–46 (U+2013)', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Layout.tsx',
            range: { start: 42, end: 46 },
            code: 'a\nb\nc\nd\ne',
          }}
        />,
      );
      // The en-dash is U+2013, NOT a hyphen-minus U+002D
      expect(screen.getByText('L42–46')).toBeTruthy();
    });

    it('renders "5 lines" in the header', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Layout.tsx',
            range: { start: 42, end: 46 },
            code: 'a\nb\nc\nd\ne',
          }}
        />,
      );
      expect(screen.getByText('5 lines')).toBeTruthy();
    });

    it('renders line numbers 42 through 46', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Layout.tsx',
            range: { start: 42, end: 46 },
            code: 'a\nb\nc\nd\ne',
          }}
        />,
      );
      for (const lineNum of [42, 43, 44, 45, 46]) {
        expect(screen.getByText(String(lineNum))).toBeTruthy();
      }
    });

    it('does NOT render the expand button', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Layout.tsx',
            range: { start: 42, end: 46 },
            code: 'a\nb\nc\nd\ne',
          }}
        />,
      );
      expect(queryExpandButton()).toBeNull();
    });
  });

  describe('H2 — single-line snippet without end', () => {
    it('renders range label L6 (no dash)', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'config.ts',
            range: { start: 6 },
            code: 'sidebarWidth: 256,',
          }}
        />,
      );
      expect(screen.getByText('L6')).toBeTruthy();
    });

    it('renders "1 lines" in the header', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'config.ts',
            range: { start: 6 },
            code: 'sidebarWidth: 256,',
          }}
        />,
      );
      expect(screen.getByText('1 lines')).toBeTruthy();
    });

    it('does NOT render the expand button', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'config.ts',
            range: { start: 6 },
            code: 'sidebarWidth: 256,',
          }}
        />,
      );
      expect(queryExpandButton()).toBeNull();
    });
  });

  describe('H3 — range.end equals range.start', () => {
    it('renders range label L10 with no dash when end === start', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'index.ts',
            range: { start: 10, end: 10 },
            code: 'const x = 1;',
          }}
        />,
      );
      expect(screen.getByText('L10')).toBeTruthy();
      // Confirm there is no en-dash variant
      expect(screen.queryByText('L10–10')).toBeNull();
    });
  });

  describe('H4 — 12-line snippet with expand/collapse toggle', () => {
    // Lines '1'..'12' are the line CONTENT; the line NUMBERS in the DOM are
    // also 1..12 (range.start = 1). We use non-numeric content ('line-a'
    // through 'line-l') so that `queryByText('8')` exclusively targets the
    // line-number cell, never the content cell.
    const TWELVE_LINES =
      'line-a\nline-b\nline-c\nline-d\nline-e\nline-f\nline-g\nline-h\nline-i\nline-j\nline-k\nline-l';

    it('initially renders only 7 line-number cells (1..7) and hides line number 8', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Big.tsx',
            range: { start: 1 },
            code: TWELVE_LINES,
          }}
        />,
      );
      // First 7 line numbers present
      for (const n of [1, 2, 3, 4, 5, 6, 7]) {
        expect(screen.queryByText(String(n))).toBeTruthy();
      }
      // Line number 8 absent while collapsed
      expect(screen.queryByText('8')).toBeNull();
    });

    it('initially shows the expand button labeled "Show all 12 lines"', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Big.tsx',
            range: { start: 1 },
            code: TWELVE_LINES,
          }}
        />,
      );
      const btn = queryExpandButton();
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toContain('Show all 12 lines');
    });

    it('after clicking expand: all 12 line numbers are present and button says "Collapse"', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Big.tsx',
            range: { start: 1 },
            code: TWELVE_LINES,
          }}
        />,
      );
      fireEvent.click(screen.getByTestId('chat-user-code-ref-expand'));

      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        expect(screen.queryByText(String(n))).toBeTruthy();
      }
      expect(screen.getByTestId('chat-user-code-ref-expand').textContent).toContain('Collapse');
    });

    it('after clicking expand then collapse: back to 7 rows and "Show all 12 lines"', () => {
      render(
        <CodeRefCard
          codeRef={{
            file: 'Big.tsx',
            range: { start: 1 },
            code: TWELVE_LINES,
          }}
        />,
      );
      fireEvent.click(screen.getByTestId('chat-user-code-ref-expand'));
      fireEvent.click(screen.getByTestId('chat-user-code-ref-expand'));

      // Line number 8 gone again
      expect(screen.queryByText('8')).toBeNull();
      expect(screen.getByTestId('chat-user-code-ref-expand').textContent).toContain('Show all 12 lines');
    });
  });
});
