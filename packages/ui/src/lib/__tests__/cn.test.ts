import { describe, expect, it } from 'vitest';
import { cn } from '../utils';

/**
 * `cn` used to carry an `extendTailwindMerge` config registering the v1 warm-chrome
 * font sizes (text-micro/caption/label/body/heading/title), because tailwind-merge
 * lumped unknown `text-*` names into the colour conflict group and silently dropped
 * the size whenever a colour followed. That scale was retired on 2026-08-07 and the
 * config with it — every size the app uses is a stock name tailwind-merge knows.
 *
 * These pin the behaviour that made the config necessary, so a future custom size
 * added without registering it fails here rather than in a silently unstyled chip.
 */
describe('cn — size and colour survive merge', () => {
  it('keeps a font-size alongside a text-color', () => {
    expect(cn('text-xs', 'text-muted-foreground')).toBe('text-xs text-muted-foreground');
    expect(cn('text-sm', 'text-mf-code-cmt')).toBe('text-sm text-mf-code-cmt');
    expect(cn('text-base', 'text-foreground')).toBe('text-base text-foreground');
  });

  it('still collapses two competing font-sizes (last wins)', () => {
    expect(cn('text-xs', 'text-sm')).toBe('text-sm');
    expect(cn('text-sm text-base')).toBe('text-base');
  });

  it('still collapses two competing text-colors (last wins)', () => {
    expect(cn('text-foreground', 'text-muted-foreground')).toBe('text-muted-foreground');
  });
});
