/**
 * SessionRowPrChips — the row's inline PR chips, capped by arrangeRowPrs.
 * Renders plain props, no mocking needed (Hint carries its own TooltipProvider).
 */
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { SessionRowPrChips } from '../SessionRowPrChips';

function pr(number: number, source: DetectedPr['source'], owner = 'org', repo = 'r'): DetectedPr {
  return { number, source, owner, repo, url: `https://github.com/${owner}/${repo}/pull/${number}` };
}

it('renders nothing when detectedPrs is empty', () => {
  const { container } = render(<SessionRowPrChips detectedPrs={[]} />);
  expect(container.firstChild).toBeNull();
});

it('renders one chip whose text is "#42" for a single PR', () => {
  render(<SessionRowPrChips detectedPrs={[pr(42, 'created')]} />);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-42').textContent).toBe('#42');
});

it('renders exactly 2 chips for 5 PRs', () => {
  const { container } = render(
    <SessionRowPrChips
      detectedPrs={[pr(1, 'created'), pr(2, 'created'), pr(3, 'created'), pr(4, 'created'), pr(5, 'created')]}
    />,
  );
  expect(container.querySelectorAll('[data-testid^="sessions-row-meta-icon-pr-"]')).toHaveLength(2);
});

it('prioritises created PRs over mentioned ones when picking which chips render', () => {
  render(<SessionRowPrChips detectedPrs={[pr(1, 'mentioned'), pr(2, 'created'), pr(3, 'mentioned')]} />);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-2')).toBeTruthy();
  expect(screen.getByTestId('sessions-row-meta-icon-pr-1')).toBeTruthy();
  expect(screen.queryByTestId('sessions-row-meta-icon-pr-3')).toBeNull();
});

it('sets each chip href to the PR url', () => {
  render(<SessionRowPrChips detectedPrs={[pr(42, 'created')]} />);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-42')).toHaveAttribute(
    'href',
    'https://github.com/org/r/pull/42',
  );
});

it('keeps same-numbered PRs from different repos distinct via data-pr-url', () => {
  const { container } = render(
    <SessionRowPrChips detectedPrs={[pr(7, 'created', 'org', 'a'), pr(7, 'created', 'org', 'b')]} />,
  );
  expect(container.querySelectorAll('[data-pr-url]')).toHaveLength(2);
  expect(container.querySelector('[data-pr-url="https://github.com/org/a/pull/7"]')).toBeTruthy();
  expect(container.querySelector('[data-pr-url="https://github.com/org/b/pull/7"]')).toBeTruthy();
});

it('does not bubble a chip click to a parent handler', async () => {
  const onClick = vi.fn();
  render(
    <div onClick={onClick}>
      <SessionRowPrChips detectedPrs={[pr(42, 'created')]} />
    </div>,
  );
  await userEvent.click(screen.getByTestId('sessions-row-meta-icon-pr-42'));
  expect(onClick).not.toHaveBeenCalled();
});
