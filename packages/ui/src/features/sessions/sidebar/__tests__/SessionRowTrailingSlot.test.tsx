/**
 * SessionRowTrailingSlot — the row's one permanently reserved trailing
 * region: the relative timestamp at rest, the three hover-action buttons
 * painted over it on hover. Its own width never changes.
 */
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionRowTrailingSlot } from '../SessionRowTrailingSlot';
import { SESSION_ROW_TRAILING_SLOT_PX } from '../session-row-layout';

function noop() {
  /* expected */
}

it('reserves the fixed trailing-slot width at rest', () => {
  render(
    <SessionRowTrailingSlot updatedAt={Date.now()} pinned={false} onPin={noop} onUnpin={noop} onTags={vi.fn()} onArchive={noop} />,
  );
  const slot = screen.getByTestId('sessions-row-trailing-slot');
  expect(slot.style.width).toBe(`${SESSION_ROW_TRAILING_SLOT_PX}px`);
});

it('shows the relative timestamp at rest', () => {
  render(
    <SessionRowTrailingSlot
      updatedAt={1749284160000}
      pinned={false}
      onPin={noop}
      onUnpin={noop}
      onTags={vi.fn()}
      onArchive={noop}
    />,
  );
  expect(screen.getByTestId('sessions-row-relative-time').textContent?.trim().length).toBeGreaterThan(0);
});

it('renders all three hover actions, always present in the DOM', () => {
  render(
    <SessionRowTrailingSlot
      updatedAt={Date.now()}
      pinned={false}
      onPin={noop}
      onUnpin={noop}
      onTags={vi.fn()}
      onArchive={noop}
    />,
  );
  expect(screen.getByTestId('sessions-row-action-pin')).toBeTruthy();
  expect(screen.getByTestId('sessions-row-action-tags')).toBeTruthy();
  expect(screen.getByTestId('sessions-row-action-archive')).toBeTruthy();
});
