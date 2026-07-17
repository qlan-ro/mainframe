/**
 * ReadMoreBubble — behavior tests for the toggle-visibility threshold.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadMoreBubble } from '../ReadMoreBubble';

describe('ReadMoreBubble — Find anchor', () => {
  it('carries data-text-part on the content div so in-chat Find can locate user-message text', () => {
    const { container } = render(<ReadMoreBubble>some text</ReadMoreBubble>);
    const anchor = container.querySelector('[data-text-part]');
    expect(anchor).toBeTruthy();
    expect(anchor).toHaveTextContent('some text');
  });
});

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
