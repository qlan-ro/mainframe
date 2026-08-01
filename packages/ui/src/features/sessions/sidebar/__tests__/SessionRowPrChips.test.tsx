/**
 * SessionRowPrChips — the row's one inline PR chip, picked by arrangeRowPrs.
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

it('renders exactly 1 chip for 5 PRs, the most recently appended', () => {
  const { container } = render(
    <SessionRowPrChips
      detectedPrs={[pr(1, 'created'), pr(2, 'created'), pr(3, 'created'), pr(4, 'created'), pr(5, 'created')]}
    />,
  );
  expect(container.querySelectorAll('[data-testid^="sessions-row-meta-icon-pr-"]')).toHaveLength(1);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-5')).toBeTruthy();
});

it('prioritises the last-appended created PR over any mentioned one', () => {
  render(<SessionRowPrChips detectedPrs={[pr(1, 'mentioned'), pr(2, 'created'), pr(3, 'mentioned')]} />);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-2')).toBeTruthy();
  expect(screen.queryByTestId('sessions-row-meta-icon-pr-1')).toBeNull();
  expect(screen.queryByTestId('sessions-row-meta-icon-pr-3')).toBeNull();
});

it('sets the chip href to the PR url', () => {
  render(<SessionRowPrChips detectedPrs={[pr(42, 'created')]} />);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-42')).toHaveAttribute(
    'href',
    'https://github.com/org/r/pull/42',
  );
});

it('picks the last-appended PR when same-numbered PRs come from different repos', () => {
  render(<SessionRowPrChips detectedPrs={[pr(7, 'created', 'org', 'a'), pr(7, 'created', 'org', 'b')]} />);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-7')).toHaveAttribute(
    'data-pr-url',
    'https://github.com/org/b/pull/7',
  );
});

it('clamps the chip label width so it never grows past the fixed PR-region budget', () => {
  render(<SessionRowPrChips detectedPrs={[pr(42, 'created')]} />);
  expect(screen.getByTestId('sessions-row-meta-icon-pr-42').className).toContain('max-w-[5ch]');
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
