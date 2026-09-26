/**
 * RowHoverActions — behavior tests (todo #346).
 *
 * A temporary row's Pin and Tags glyphs are hidden (the daemon 409s them) and
 * its Archive glyph relabels to "Discard" — the daemon deletes rather than
 * archives a temporary chat.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RowHoverActions } from '../SessionRowHoverActions';

function renderActions(temporary: boolean, pinned = false) {
  const onPin = vi.fn();
  const onUnpin = vi.fn();
  const onTags = vi.fn();
  const onArchive = vi.fn();
  render(
    <TooltipProvider>
      <RowHoverActions
        pinned={pinned}
        temporary={temporary}
        onPin={onPin}
        onUnpin={onUnpin}
        onTags={onTags}
        onArchive={onArchive}
      />
    </TooltipProvider>,
  );
  return { onPin, onUnpin, onTags, onArchive };
}

describe('RowHoverActions — non-temporary row', () => {
  it('shows Pin, Tags and an "Archive"-labeled action', () => {
    renderActions(false);

    expect(screen.getByTestId('sessions-row-action-pin')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-row-action-tags')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-row-action-archive')).toHaveAttribute('aria-label', 'Archive');
  });
});

describe('RowHoverActions — temporary row (todo #346)', () => {
  it('hides Pin and Tags', () => {
    renderActions(true);

    expect(screen.queryByTestId('sessions-row-action-pin')).toBeNull();
    expect(screen.queryByTestId('sessions-row-action-tags')).toBeNull();
  });

  it('relabels the archive action to "Discard"', () => {
    renderActions(true);

    expect(screen.getByTestId('sessions-row-action-archive')).toHaveAttribute('aria-label', 'Discard');
  });
});
