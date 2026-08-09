/**
 * Separator alignment contract.
 *
 * The primitive ships `data-vertical:self-stretch` so a heightless vertical
 * separator fills its flex row. Give it an explicit height and CSS degrades
 * that stretch to flex-start, pinning the hairline to the TOP of the row —
 * which is how the composer, main toolbar and viewer toolbars all ended up
 * with a divider floating above their icons.
 *
 * The only override that survives is one tailwind-merge recognises as the same
 * utility under the same modifier: `data-vertical:self-center`. A bare
 * `self-center` or `self-auto` reads as a different group, so both classes
 * survive the merge and `self-stretch` — later in Tailwind's output — wins.
 * These tests pin that, because the failure is invisible in markup.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Separator } from '../separator';

function classesOf(testId: string): string[] {
  return screen.getByTestId(testId).className.split(/\s+/);
}

describe('Separator', () => {
  it('keeps self-stretch when no height is given, so a bare divider fills its row', () => {
    render(<Separator data-testid="sep" orientation="vertical" />);
    expect(classesOf('sep')).toContain('data-vertical:self-stretch');
  });

  it('drops self-stretch for data-vertical:self-center, centering a fixed-height divider', () => {
    render(<Separator data-testid="sep" orientation="vertical" className="h-3 data-vertical:self-center" />);
    const classes = classesOf('sep');
    expect(classes).toContain('data-vertical:self-center');
    expect(classes).not.toContain('data-vertical:self-stretch');
  });

  it('does not drop self-stretch for a bare self-center — the override that silently fails', () => {
    render(<Separator data-testid="sep" orientation="vertical" className="h-3 self-center" />);
    expect(classesOf('sep')).toContain('data-vertical:self-stretch');
  });
});
