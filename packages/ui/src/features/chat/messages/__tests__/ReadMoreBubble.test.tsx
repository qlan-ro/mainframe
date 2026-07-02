/**
 * ReadMoreBubble — behavior tests for the toggle-visibility threshold and
 * the design-parity spacing fix (7.11: icon/label gap 4, bubble-to-button
 * gap 5 via flex column instead of a margin).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadMoreBubble } from '../ReadMoreBubble';

describe('ReadMoreBubble — toggle visibility', () => {
  it('does not render the Read more toggle for short content', () => {
    render(<ReadMoreBubble>short text</ReadMoreBubble>);
    expect(screen.queryByTestId('chat-user-readmore-toggle')).not.toBeInTheDocument();
  });

  it('renders the Read more toggle for content over the char threshold', () => {
    render(<ReadMoreBubble>{'x'.repeat(700)}</ReadMoreBubble>);
    expect(screen.getByTestId('chat-user-readmore-toggle')).toBeInTheDocument();
  });
});

describe('ReadMoreBubble — 7.11: icon/label gap and bubble-to-button spacing', () => {
  it('the toggle button has gap-2 (4px) between the label and chevron', () => {
    render(<ReadMoreBubble>{'x'.repeat(700)}</ReadMoreBubble>);
    const toggle = screen.getByTestId('chat-user-readmore-toggle');
    expect(toggle.className).toContain('gap-2');
    expect(toggle.className).not.toContain('gap-0.5');
  });

  it('the outer wrapper is a flex column with gap-[5px] (not mt-1 margin) between the card and the button', () => {
    render(<ReadMoreBubble>{'x'.repeat(700)}</ReadMoreBubble>);
    const toggle = screen.getByTestId('chat-user-readmore-toggle');
    const wrapper = toggle.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain('flex');
    expect(wrapper!.className).toContain('flex-col');
    expect(wrapper!.className).toContain('gap-[5px]');
    expect(toggle.className).not.toContain('mt-1');
  });
});
