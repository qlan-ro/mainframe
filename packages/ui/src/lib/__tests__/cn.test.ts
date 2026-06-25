import { describe, expect, it } from 'vitest';
import { cn } from '../utils';

/**
 * Regression: the warm-chrome theme defines a custom font-size scale
 * (text-micro/caption/label/body/heading/title/display/hero). An unconfigured
 * tailwind-merge treats those `text-*` size utilities as the same conflict group
 * as `text-<color>` utilities and silently DROPS the size when a color follows —
 * so e.g. a chip styled `text-label text-muted-foreground` rendered at the
 * inherited 13px instead of 12px. `cn` must register the custom sizes so size and
 * colour survive together.
 */
describe('cn — custom font-size utilities survive merge', () => {
  it('keeps a custom text-size alongside a text-color', () => {
    expect(cn('text-label', 'text-muted-foreground')).toBe('text-label text-muted-foreground');
    expect(cn('text-micro', 'text-mf-text-3')).toBe('text-micro text-mf-text-3');
    expect(cn('text-caption', 'text-foreground')).toBe('text-caption text-foreground');
  });

  it('still collapses two competing font-sizes (last wins)', () => {
    expect(cn('text-label', 'text-body')).toBe('text-body');
    expect(cn('text-micro text-heading')).toBe('text-heading');
  });

  it('still collapses two competing text-colors (last wins)', () => {
    expect(cn('text-foreground', 'text-muted-foreground')).toBe('text-muted-foreground');
  });
});
