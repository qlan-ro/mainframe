/**
 * RecentDirs — behavior tests.
 *
 * Behaviors covered:
 *  - Renders nothing for an empty `paths` list.
 *  - Renders one row per path and clicking a row calls onPick with that path.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecentDirs } from '../RecentDirs';

describe('RecentDirs — empty list', () => {
  it('renders nothing when paths is empty', () => {
    const { container } = render(<RecentDirs paths={[]} onPick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('RecentDirs — rows + pick', () => {
  it('renders a row per path and clicking one calls onPick with that path', async () => {
    const onPick = vi.fn();
    render(<RecentDirs paths={['/Users/me/alpha', '/Users/me/beta']} onPick={onPick} />);

    expect(screen.getByTestId('directory-picker-recent')).not.toBeNull();
    expect(screen.getByTestId('directory-picker-recent-/Users/me/alpha')).not.toBeNull();
    expect(screen.getByTestId('directory-picker-recent-/Users/me/beta')).not.toBeNull();

    await userEvent.click(screen.getByTestId('directory-picker-recent-/Users/me/beta'));

    expect(onPick).toHaveBeenCalledWith('/Users/me/beta');
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
