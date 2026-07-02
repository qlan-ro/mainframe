/**
 * code-snippet — behavior tests for SnippetBlock's collapse/expand clamp (7.8).
 *
 * Design (UMCodeRef, 11-usermessages.jsx:324-365): snippets longer than
 * COLLAPSED_LINES (7) render behind a fade + "Show all N lines" expander;
 * once expanded the block scrolls (max-height 240px). Short snippets (<=7
 * lines) render with no clamp/expander at all.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { SnippetBlock } from '../code-snippet';

function lines(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`);
}

describe('SnippetBlock — short snippet (<= 7 lines): no clamp', () => {
  it('renders all lines with no expander button', () => {
    render(<SnippetBlock lines={lines(7)} start={1} />);
    expect(screen.getByText('line 1')).toBeInTheDocument();
    expect(screen.getByText('line 7')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-user-snippet-expand')).not.toBeInTheDocument();
  });
});

describe('SnippetBlock — long snippet (> 7 lines): clamp + expander', () => {
  it('renders the "Show all N lines" expander with the correct count', () => {
    render(<SnippetBlock lines={lines(12)} start={1} />);
    expect(screen.getByTestId('chat-user-snippet-expand')).toHaveTextContent('Show all 12 lines');
  });

  it('applies a max-height clamp to the scroll container before expanding', () => {
    render(<SnippetBlock lines={lines(12)} start={1} />);
    const scrollArea = screen.getByTestId('chat-user-snippet-scroll');
    expect(scrollArea.className).toContain('overflow-hidden');
  });

  it('expands to a scrollable max-h-[240px] container and hides the expander after clicking', () => {
    render(<SnippetBlock lines={lines(12)} start={1} />);
    fireEvent.click(screen.getByTestId('chat-user-snippet-expand'));
    const scrollArea = screen.getByTestId('chat-user-snippet-scroll');
    expect(scrollArea.className).toContain('max-h-[240px]');
    expect(scrollArea.className).toContain('overflow-y-auto');
    expect(screen.queryByTestId('chat-user-snippet-expand')).not.toBeInTheDocument();
  });

  it('still renders every line once expanded', () => {
    render(<SnippetBlock lines={lines(12)} start={1} />);
    fireEvent.click(screen.getByTestId('chat-user-snippet-expand'));
    expect(screen.getByText('line 12')).toBeInTheDocument();
  });
});
