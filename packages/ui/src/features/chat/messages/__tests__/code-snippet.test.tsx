/**
 * code-snippet — behavior tests for SnippetBlock's collapse/expand clamp (7.8).
 *
 * Design (UMCodeRef, 11-usermessages.jsx:324-365): snippets longer than
 * COLLAPSED_LINES (7) render behind a fade + a PERSISTENT footer-bar toggle —
 * collapsed shows "Show all N lines" + a down chevron, expanded shows
 * "Collapse" + an up chevron and re-collapses on click (two-way, the button
 * never unmounts). Short snippets (<=7 lines) render with no clamp/toggle at
 * all.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { SnippetBlock } from '../code-snippet';

function lines(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`);
}

describe('SnippetBlock — short snippet (<= 7 lines): no clamp', () => {
  it('renders all lines with no toggle button', () => {
    render(<SnippetBlock id="a" lines={lines(7)} start={1} />);
    expect(screen.getByText('line 1')).toBeInTheDocument();
    expect(screen.getByText('line 7')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-user-snippet-expand-a')).not.toBeInTheDocument();
  });
});

describe('SnippetBlock — long snippet (> 7 lines): clamp + toggle', () => {
  it('renders the "Show all N lines" toggle with the correct count', () => {
    render(<SnippetBlock id="a" lines={lines(12)} start={1} />);
    expect(screen.getByTestId('chat-user-snippet-expand-a')).toHaveTextContent('Show all 12 lines');
  });

  it('applies a max-height clamp to the scroll container before expanding', () => {
    render(<SnippetBlock id="a" lines={lines(12)} start={1} />);
    const scrollArea = screen.getByTestId('chat-user-snippet-scroll-a');
    expect(scrollArea.className).toContain('overflow-hidden');
  });

  it('expands to a scrollable max-h-[240px] container and flips the toggle to "Collapse"', () => {
    render(<SnippetBlock id="a" lines={lines(12)} start={1} />);
    fireEvent.click(screen.getByTestId('chat-user-snippet-expand-a'));
    const scrollArea = screen.getByTestId('chat-user-snippet-scroll-a');
    expect(scrollArea.className).toContain('max-h-[240px]');
    expect(scrollArea.className).toContain('overflow-y-auto');
    const toggle = screen.getByTestId('chat-user-snippet-expand-a');
    expect(toggle).toHaveTextContent('Collapse');
  });

  it('still renders every line once expanded', () => {
    render(<SnippetBlock id="a" lines={lines(12)} start={1} />);
    fireEvent.click(screen.getByTestId('chat-user-snippet-expand-a'));
    expect(screen.getByText('line 12')).toBeInTheDocument();
  });

  it('round-trips expand → collapse: the toggle persists and re-clamps the scroll container', () => {
    render(<SnippetBlock id="a" lines={lines(12)} start={1} />);
    const toggle = screen.getByTestId('chat-user-snippet-expand-a');

    fireEvent.click(toggle);
    expect(screen.getByTestId('chat-user-snippet-expand-a')).toHaveTextContent('Collapse');

    fireEvent.click(screen.getByTestId('chat-user-snippet-expand-a'));
    const toggleAfterCollapse = screen.getByTestId('chat-user-snippet-expand-a');
    expect(toggleAfterCollapse).toHaveTextContent('Show all 12 lines');
    const scrollArea = screen.getByTestId('chat-user-snippet-scroll-a');
    expect(scrollArea.className).toContain('overflow-hidden');
    expect(scrollArea.className).not.toContain('overflow-y-auto');
  });
});

describe('SnippetBlock — multiple instances: unique testids keyed by id', () => {
  it('does not collide when two long snippets render in the same tree', () => {
    render(
      <>
        <SnippetBlock id="first" lines={lines(12)} start={1} />
        <SnippetBlock id="second" lines={lines(12)} start={1} />
      </>,
    );
    expect(screen.getByTestId('chat-user-snippet-scroll-first')).toBeInTheDocument();
    expect(screen.getByTestId('chat-user-snippet-scroll-second')).toBeInTheDocument();
    expect(screen.getByTestId('chat-user-snippet-expand-first')).toBeInTheDocument();
    expect(screen.getByTestId('chat-user-snippet-expand-second')).toBeInTheDocument();
  });
});
