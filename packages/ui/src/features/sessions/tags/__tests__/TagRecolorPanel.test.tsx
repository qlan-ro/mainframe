/**
 * TagRecolorPanel — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  1. Renders `data-testid="sessions-tag-recolor-panel"` root, one swatch
 *     button per palette color (`TAG_PALETTE.length`), and each swatch
 *     carries an `aria-label` of the form `Set color <c>`.
 *  2. Panel header includes the tag name (`/Recolor "alpha"/`).
 *  3. Clicking a swatch calls `onPick(<color>)` exactly once.
 */
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';
import { TagRecolorPanel } from '../TagRecolorPanel';

// ---------------------------------------------------------------------------
// Helper — render with sensible defaults
// ---------------------------------------------------------------------------

function renderPanel(props: { tagName?: string; onPick?: (color: string) => void; onClose?: () => void }) {
  render(
    <TagRecolorPanel
      tagName={props.tagName ?? 'alpha'}
      onPick={props.onPick ?? (() => undefined)}
      onClose={props.onClose ?? (() => undefined)}
    />,
  );
}

it('renders the root panel, one swatch per palette color, and matching aria-labels', () => {
  renderPanel({});

  const panel = screen.getByTestId('sessions-tag-recolor-panel');
  expect(panel).toBeTruthy();

  // TAG_PALETTE has exactly 10 colors at the time of writing.
  // Hardcoded here so the test fails if the palette grows or shrinks unexpectedly.
  expect(TAG_PALETTE.length).toBe(10);
  expect(panel.querySelectorAll('button').length).toBe(10);

  expect(screen.getByTestId('sessions-tag-color-blue').getAttribute('aria-label')).toBe('Set color blue');
  expect(screen.getByTestId('sessions-tag-color-red').getAttribute('aria-label')).toBe('Set color red');
});

it('shows the tag name in the header', () => {
  renderPanel({ tagName: 'alpha' });
  expect(screen.getByText(/Recolor "alpha"/)).toBeTruthy();
});

it('calls onPick with the clicked color exactly once', async () => {
  const onPick = vi.fn();
  renderPanel({ onPick });

  await userEvent.click(screen.getByTestId('sessions-tag-color-red'));

  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledWith('red');
});
