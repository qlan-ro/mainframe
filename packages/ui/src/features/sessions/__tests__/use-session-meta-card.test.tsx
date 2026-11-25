// @vitest-environment jsdom

/**
 * Radix's hover card keeps one open timer per card and overwrites its id: a row
 * that is hovered and focused starts two, and leaving or unmounting clears only
 * the last. The other one asks to open a card for a row that is gone.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { useSessionMetaCard } from '../use-session-meta-card';

const OPEN_DELAY = 500;
const asked = vi.fn<(open: boolean) => void>();

function Row() {
  const rowRef = useRef<HTMLDivElement>(null);
  const card = useSessionMetaCard(rowRef);
  const onOpenChange = (open: boolean) => {
    asked(open);
    card.onOpenChange(open);
  };
  return (
    <HoverCard open={card.open} onOpenChange={onOpenChange} openDelay={OPEN_DELAY}>
      <HoverCardTrigger asChild>
        <div ref={rowRef}>
          <button type="button">Row</button>
        </div>
      </HoverCardTrigger>
      <HoverCardContent>Details</HoverCardContent>
    </HoverCard>
  );
}

function List() {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShown(false)}>
        Remove
      </button>
      {shown && <Row />}
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  asked.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it('does nothing when a leaked timer fires after the row and its document are gone', () => {
  render(<List />);
  const row = screen.getByRole('button', { name: 'Row' });
  fireEvent.pointerEnter(row.parentElement!, { pointerType: 'mouse' });
  fireEvent.focus(row);
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(screen.queryByRole('button', { name: 'Row' })).toBeNull();

  // A late timer can outlive the page it was started in.
  const page = globalThis.document;
  vi.stubGlobal('document', undefined);
  try {
    expect(() => vi.advanceTimersByTime(OPEN_DELAY)).not.toThrow();
  } finally {
    vi.stubGlobal('document', page);
    vi.unstubAllGlobals();
  }
  expect(asked).toHaveBeenCalledWith(true);
});
