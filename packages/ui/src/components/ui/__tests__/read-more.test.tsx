import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadMore } from '../read-more';

const long = 'x'.repeat(700);

describe('ReadMore', () => {
  it('shows no toggle when under threshold', () => {
    render(
      <ReadMore measureText="short" testId="t-toggle">
        short
      </ReadMore>,
    );
    expect(screen.queryByTestId('t-toggle')).toBeNull();
  });

  it('toggles Read more / Show less past threshold', () => {
    render(
      <ReadMore measureText={long} testId="t-toggle">
        {long}
      </ReadMore>,
    );
    const btn = screen.getByTestId('t-toggle');
    expect(btn).toHaveTextContent('Read more');
    fireEvent.click(btn);
    expect(btn).toHaveTextContent('Show less');
  });

  it('caps the collapsed height too, so a block child such as a code block is clipped in Chromium', () => {
    render(
      <ReadMore measureText={long} testId="t-toggle" contentProps={{ 'data-testid': 't-content' }}>
        {long}
      </ReadMore>,
    );
    const content = screen.getByTestId('t-content');
    // jsdom reserialises the expression, so match its parts rather than the exact text.
    expect(content.style.maxHeight).toMatch(/^calc\(.*lh.*rem/);
    fireEvent.click(screen.getByTestId('t-toggle'));
    expect(content.style.maxHeight).toBe('');
  });
});
