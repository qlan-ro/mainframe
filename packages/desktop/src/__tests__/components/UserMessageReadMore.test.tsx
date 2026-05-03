import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { ReadMoreBubble } from '../../renderer/components/chat/assistant-ui/messages/ReadMoreBubble.js';

const SHORT_TEXT = 'Short message.';
const LONG_TEXT = 'a'.repeat(601); // > 600 chars threshold

describe('ReadMoreBubble', () => {
  it('renders short text without a read-more toggle', () => {
    render(<ReadMoreBubble>{SHORT_TEXT}</ReadMoreBubble>);
    expect(screen.queryByRole('button', { name: /read more/i })).not.toBeInTheDocument();
    expect(screen.getByText(SHORT_TEXT)).toBeInTheDocument();
  });

  it('renders long text clamped with a "Read more" button', () => {
    render(<ReadMoreBubble>{LONG_TEXT}</ReadMoreBubble>);
    expect(screen.getByRole('button', { name: /read more/i })).toBeInTheDocument();
  });

  it('expands to show full text when "Read more" is clicked', async () => {
    render(<ReadMoreBubble>{LONG_TEXT}</ReadMoreBubble>);
    const btn = screen.getByRole('button', { name: /read more/i });
    await userEvent.click(btn);
    expect(screen.queryByRole('button', { name: /read more/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
  });

  it('collapses back when "Show less" is clicked', async () => {
    render(<ReadMoreBubble>{LONG_TEXT}</ReadMoreBubble>);
    await userEvent.click(screen.getByRole('button', { name: /read more/i }));
    await userEvent.click(screen.getByRole('button', { name: /show less/i }));
    expect(screen.getByRole('button', { name: /read more/i })).toBeInTheDocument();
  });

  it('applies line-clamp class when collapsed', () => {
    const { container } = render(<ReadMoreBubble>{LONG_TEXT}</ReadMoreBubble>);
    const contentDiv = container.querySelector('[data-clamp]');
    expect(contentDiv?.className).toMatch(/line-clamp/);
  });

  it('removes line-clamp class when expanded', async () => {
    const { container } = render(<ReadMoreBubble>{LONG_TEXT}</ReadMoreBubble>);
    await userEvent.click(screen.getByRole('button', { name: /read more/i }));
    const contentDiv = container.querySelector('[data-clamp]');
    expect(contentDiv?.className).not.toMatch(/line-clamp/);
  });
});
