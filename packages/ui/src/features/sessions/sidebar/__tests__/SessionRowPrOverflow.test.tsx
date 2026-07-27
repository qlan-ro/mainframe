/**
 * SessionRowPrOverflow — the row-level PR overflow indicator and its reveal
 * popover. Follows features/chat/composer/config-toolbar/__tests__/ProviderModelSelect.test.tsx:
 * Hint wraps PopoverTrigger the same way Hint wraps TooltipTrigger there, and
 * Radix's popover portal renders inline under document.body in jsdom, so
 * screen.getByTestId finds panel contents immediately after userEvent.click
 * settles. Hint carries its own TooltipProvider — no extra wrapper needed.
 */
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { SessionRowPrOverflow } from '../SessionRowPrOverflow';

function pr(number: number, source: DetectedPr['source'], owner = 'org', repo = 'r'): DetectedPr {
  return { number, source, owner, repo, url: `https://github.com/${owner}/${repo}/pull/${number}` };
}

function fivePrs(): DetectedPr[] {
  return [pr(1, 'created'), pr(2, 'created'), pr(3, 'mentioned'), pr(4, 'mentioned'), pr(5, 'created')];
}

it('renders nothing when only 2 PRs are detected (nothing is hidden)', () => {
  const { container } = render(<SessionRowPrOverflow detectedPrs={[pr(1, 'created'), pr(2, 'created')]} />);
  expect(container.firstChild).toBeNull();
});

it('shows the total PR count and an aria-label naming it, for 5 PRs', () => {
  render(<SessionRowPrOverflow detectedPrs={fivePrs()} />);
  const indicator = screen.getByTestId('sessions-row-pr-overflow');
  expect(indicator.textContent).toContain('5');
  expect(indicator).toHaveAttribute('aria-label', 'Show all 5 pull requests');
});

it('clamps the visible label at "99+" while the aria-label keeps the exact count for 120 PRs', () => {
  const many = Array.from({ length: 120 }, (_, i) => pr(i + 1, 'created'));
  render(<SessionRowPrOverflow detectedPrs={many} />);
  const indicator = screen.getByTestId('sessions-row-pr-overflow');
  expect(indicator.textContent).toContain('99+');
  expect(indicator).toHaveAttribute('aria-label', 'Show all 120 pull requests');
});

it('opens the panel on click, listing one item per PR including the inline ones', async () => {
  render(<SessionRowPrOverflow detectedPrs={fivePrs()} />);
  await userEvent.click(screen.getByTestId('sessions-row-pr-overflow'));

  expect(screen.getByTestId('sessions-row-pr-overflow-panel')).toBeTruthy();
  for (const number of [1, 2, 3, 4, 5]) {
    const item = screen.getByTestId(`sessions-row-pr-overflow-item-${number}`);
    expect(item).toHaveAttribute('href', `https://github.com/org/r/pull/${number}`);
    expect(item.textContent).toContain(`#${number}`);
    expect(item.textContent).toContain('org/r');
  }
});

it('is reachable by keyboard and opens the panel on Enter', async () => {
  const user = userEvent.setup();
  render(<SessionRowPrOverflow detectedPrs={fivePrs()} />);

  let reached = false;
  for (let i = 0; i < 5; i++) {
    await user.tab();
    if (document.activeElement === screen.getByTestId('sessions-row-pr-overflow')) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);

  await user.keyboard('{Enter}');
  expect(screen.getByTestId('sessions-row-pr-overflow-panel')).toBeTruthy();
});

it('closes the panel on Escape', async () => {
  const user = userEvent.setup();
  render(<SessionRowPrOverflow detectedPrs={fivePrs()} />);

  await user.click(screen.getByTestId('sessions-row-pr-overflow'));
  expect(screen.getByTestId('sessions-row-pr-overflow-panel')).toBeTruthy();

  await user.keyboard('{Escape}');
  expect(screen.queryByTestId('sessions-row-pr-overflow-panel')).toBeNull();
});

it('shows a "mentioned" marker only on mentioned entries', async () => {
  render(<SessionRowPrOverflow detectedPrs={fivePrs()} />);
  await userEvent.click(screen.getByTestId('sessions-row-pr-overflow'));

  expect(screen.getByTestId('sessions-row-pr-overflow-item-3').textContent).toContain('mentioned');
  expect(screen.getByTestId('sessions-row-pr-overflow-item-1').textContent).not.toContain('mentioned');
});

it('does not bubble a click on the indicator to a parent handler', async () => {
  const onClick = vi.fn();
  render(
    <div onClick={onClick}>
      <SessionRowPrOverflow detectedPrs={fivePrs()} />
    </div>,
  );
  await userEvent.click(screen.getByTestId('sessions-row-pr-overflow'));
  expect(onClick).not.toHaveBeenCalled();
});
