/**
 * SessionRowPrRegion — the row's fixed, never-yielding PR affordance.
 * Exactly one of the inline chip or the count indicator renders, chosen by
 * PR count, never both.
 */
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { SessionRowPrRegion } from '../SessionRowPrRegion';

function pr(number: number, source: DetectedPr['source'] = 'created'): DetectedPr {
  return { number, source, owner: 'org', repo: 'r', url: `https://github.com/org/r/pull/${number}` };
}

it('renders nothing when there are no detected PRs', () => {
  const { container } = render(<SessionRowPrRegion detectedPrs={[]} />);
  expect(container.firstChild).toBeNull();
});

it('renders the inline chip, not the count indicator, for exactly one PR', () => {
  render(<SessionRowPrRegion detectedPrs={[pr(42)]} />);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-42')).toBeTruthy();
  expect(screen.queryByTestId('sessions-row-pr-overflow')).toBeNull();
});

it('renders the count indicator, not the inline chip, for more than one PR', () => {
  render(<SessionRowPrRegion detectedPrs={[pr(1), pr(2)]} />);
  expect(screen.getByTestId('sessions-row-pr-overflow')).toBeTruthy();
  expect(screen.queryByTestId(/sessions-row-meta-icon-pr-/)).toBeNull();
});

it('never shrinks with the row', () => {
  render(<SessionRowPrRegion detectedPrs={[pr(1)]} />);
  expect(screen.getByTestId('sessions-row-pr-region').className).toContain('flex-shrink-0');
});
