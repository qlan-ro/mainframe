/**
 * TagRecolorPanel — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  1. Renders `data-testid="sessions-tag-recolor-panel"` root.
 *  2. Renders one swatch button per palette color — `sessions-tag-color-blue`
 *     exists; total swatch count equals `TAG_PALETTE.length` (10).
 *  3. Each swatch carries an `aria-label` of the form `Set color <c>`.
 *  4. Clicking `sessions-tag-color-red` calls `onPick('red')` exactly once.
 *  5. Panel header includes the tag name (`/Recolor "alpha"/` when tagName='alpha').
 */
import { describe, it, expect, vi } from 'vitest';
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

// ---------------------------------------------------------------------------
// 1. Root test-id is rendered
// ---------------------------------------------------------------------------

describe('TagRecolorPanel — renders root data-testid', () => {
  it('renders sessions-tag-recolor-panel root element', () => {
    renderPanel({});
    expect(screen.getByTestId('sessions-tag-recolor-panel')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. One swatch per palette color — blue exists; total count is 10
// ---------------------------------------------------------------------------

describe('TagRecolorPanel — renders one swatch per palette color', () => {
  it('renders sessions-tag-color-blue swatch', () => {
    renderPanel({});
    expect(screen.getByTestId('sessions-tag-color-blue')).toBeTruthy();
  });

  it('renders exactly TAG_PALETTE.length (10) swatch buttons', () => {
    renderPanel({});
    // TAG_PALETTE has exactly 10 colors at the time of writing.
    // Hardcoded here so the test fails if the palette grows or shrinks unexpectedly.
    expect(TAG_PALETTE.length).toBe(10);

    const panel = screen.getByTestId('sessions-tag-recolor-panel');
    const swatches = panel.querySelectorAll('button');
    expect(swatches.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 3. Each swatch has aria-label "Set color <c>"
// ---------------------------------------------------------------------------

describe('TagRecolorPanel — swatch aria-labels', () => {
  it('sessions-tag-color-blue has aria-label "Set color blue"', () => {
    renderPanel({});
    const blue = screen.getByTestId('sessions-tag-color-blue');
    expect(blue.getAttribute('aria-label')).toBe('Set color blue');
  });

  it('sessions-tag-color-red has aria-label "Set color red"', () => {
    renderPanel({});
    const red = screen.getByTestId('sessions-tag-color-red');
    expect(red.getAttribute('aria-label')).toBe('Set color red');
  });
});

// ---------------------------------------------------------------------------
// 4. Clicking sessions-tag-color-red calls onPick('red') exactly once
// ---------------------------------------------------------------------------

describe("TagRecolorPanel — clicking red swatch calls onPick('red') once", () => {
  it("calls onPick with 'red' exactly once when sessions-tag-color-red is clicked", async () => {
    const onPick = vi.fn();
    renderPanel({ onPick });

    await userEvent.click(screen.getByTestId('sessions-tag-color-red'));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('red');
  });
});

// ---------------------------------------------------------------------------
// 5. Header includes the tag name
// ---------------------------------------------------------------------------

describe('TagRecolorPanel — header includes the tag name', () => {
  it('shows /Recolor "alpha"/ text when tagName is "alpha"', () => {
    renderPanel({ tagName: 'alpha' });
    expect(screen.getByText(/Recolor "alpha"/)).toBeTruthy();
  });
});
