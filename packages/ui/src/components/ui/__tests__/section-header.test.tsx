import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHeader } from '../section-header';

describe('SectionHeader', () => {
  it('renders its children as the label', () => {
    render(<SectionHeader data-testid="sh">Favorites</SectionHeader>);
    expect(screen.getByTestId('sh')).toHaveTextContent('Favorites');
  });

  it('uses the muted caption recipe, not the old bold/uppercase eyebrow', () => {
    render(<SectionHeader data-testid="sh">Favorites</SectionHeader>);
    const cls = screen.getByTestId('sh').className;
    expect(cls).toContain('text-caption');
    expect(cls).toContain('font-medium');
    expect(cls).toContain('text-muted-foreground');
    expect(cls).not.toContain('uppercase');
    expect(cls).not.toContain('font-bold');
    expect(cls).not.toContain('text-micro');
  });

  it('renders the trailing slot alongside the label', () => {
    render(
      <SectionHeader data-testid="sh" trailing={<button data-testid="sh-more">More</button>}>
        Favorites
      </SectionHeader>,
    );
    expect(screen.getByTestId('sh-more')).toBeInTheDocument();
  });

  it('merges caller className while keeping default padding', () => {
    render(
      <SectionHeader data-testid="sh" className="mt-4">
        Favorites
      </SectionHeader>,
    );
    const cls = screen.getByTestId('sh').className;
    expect(cls).toContain('mt-4');
    expect(cls).toContain('px-2');
  });
});
