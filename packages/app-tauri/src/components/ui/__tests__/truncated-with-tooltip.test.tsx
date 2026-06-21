import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TruncatedWithTooltip } from '../truncated-with-tooltip';

describe('TruncatedWithTooltip', () => {
  it('renders the visible text in a truncating span', () => {
    render(<TruncatedWithTooltip text="src/very/long/path.ts" />);
    const span = screen.getByText('src/very/long/path.ts');
    expect(span.className).toContain('truncate');
  });

  it('forwards arbitrary props (e.g. data-testid) to the visible span', () => {
    render(<TruncatedWithTooltip text="hello" data-testid="my-label" />);
    expect(screen.getByTestId('my-label').textContent).toBe('hello');
  });

  it('renders nothing when text is empty', () => {
    const { container } = render(<TruncatedWithTooltip text="" data-testid="empty" />);
    expect(screen.queryByTestId('empty')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
