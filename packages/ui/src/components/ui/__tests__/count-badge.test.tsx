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

  it('info variant is capsule-less muted gray, not a filled capsule', () => {
    render(<CountBadge count={4} variant="info" data-testid="cb" />);
    const cls = screen.getByTestId('cb').className;
    expect(cls).toContain('text-muted-foreground');
    expect(cls).toContain('text-caption');
    expect(cls).toContain('tabular-nums');
    expect(cls).not.toContain('rounded-full');
    expect(cls).not.toContain('bg-primary');
  });

  it('unread variant uses the accent ink', () => {
    render(<CountBadge count={2} variant="unread" data-testid="cb" />);
    const cls = screen.getByTestId('cb').className;
    expect(cls).toContain('text-primary');
    expect(cls).not.toContain('text-muted-foreground');
  });

  it('onAccent forces primary-foreground and drops the muted/accent ink', () => {
    render(<CountBadge count={5} variant="unread" onAccent data-testid="cb" />);
    const cls = screen.getByTestId('cb').className;
    expect(cls).toContain('text-primary-foreground');
  });

  it('alert variant is a filled primary capsule', () => {
    render(<CountBadge count={1} variant="alert" data-testid="cb" />);
    const cls = screen.getByTestId('cb').className;
    expect(cls).toContain('rounded-full');
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('text-primary-foreground');
    expect(cls).not.toContain('bg-destructive');
  });

  it('alert variant honors the destructive tone', () => {
    render(<CountBadge count={1} variant="alert" tone="destructive" data-testid="cb" />);
    const cls = screen.getByTestId('cb').className;
    expect(cls).toContain('bg-destructive');
    expect(cls).not.toContain('bg-primary');
  });
});
