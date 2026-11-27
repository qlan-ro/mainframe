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

  it('adds the block ceiling only while collapsed, and keeps the line clamp', () => {
    render(
      <ReadMore measureText={long} testId="t-toggle" contentProps={{ 'data-testid': 't-content' }}>
        {long}
      </ReadMore>,
    );
    const content = screen.getByTestId('t-content');
    expect(content.className).toContain('has-[pre]:max-h-');
    expect(content.style.getPropertyValue('--read-more-lines')).toBe('4');
    expect(content.style.webkitLineClamp || content.style.getPropertyValue('-webkit-line-clamp')).toBeTruthy();
    fireEvent.click(screen.getByTestId('t-toggle'));
    expect(content.className).not.toContain('max-h-');
  });
});
