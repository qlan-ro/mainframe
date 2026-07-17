import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountBadge } from '../count-badge';

describe('CountBadge', () => {
  it('renders nothing when the count is zero or negative', () => {
    const { container, rerender } = render(<CountBadge count={0} data-testid="cb" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CountBadge count={-3} data-testid="cb" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the count and passes through data-testid', () => {
    render(<CountBadge count={7} data-testid="cb" />);
    const el = screen.getByTestId('cb');
    expect(el).toHaveTextContent('7');
  });

  it.each([
    [
      'info is capsule-less muted gray',
      { variant: 'info' },
      ['text-muted-foreground', 'text-caption', 'tabular-nums'],
      ['rounded-full', 'bg-primary'],
    ],
    ['unread uses the accent ink', { variant: 'unread' }, ['text-primary'], ['text-muted-foreground']],
    [
      'unread + onAccent forces primary-foreground',
      { variant: 'unread', onAccent: true },
      ['text-primary-foreground'],
      [],
    ],
    [
      'alert is a filled primary capsule',
      { variant: 'alert' },
      ['rounded-full', 'bg-primary', 'text-primary-foreground'],
      ['bg-destructive'],
    ],
    [
      'alert honors the destructive tone',
      { variant: 'alert', tone: 'destructive' },
      ['bg-destructive'],
      ['bg-primary'],
    ],
  ] as [string, Record<string, unknown>, string[], string[]][])(
    'variant recipe: %s',
    (_name, props, contains, notContains) => {
      render(<CountBadge count={4} data-testid="cb" {...props} />);
      const cls = screen.getByTestId('cb').className;
      for (const c of contains) expect(cls).toContain(c);
      for (const c of notContains) expect(cls).not.toContain(c);
    },
  );
});
