/**
 * SessionContextMenu — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - When pinned=false, data-testid="sessions-ctx-pin" renders text "Pin" (not "Unpin").
 *  - When pinned=true, data-testid="sessions-ctx-pin" renders text "Unpin".
 *  - Clicking sessions-ctx-pin when pinned=false calls onPin once, NOT onUnpin.
 *  - Clicking sessions-ctx-pin when pinned=true calls onUnpin once, NOT onPin.
 *  - data-testid="sessions-ctx-rename" is always present; clicking it calls onRename once.
 *  - Clicking data-testid="sessions-ctx-archive" calls onArchive once.
 *  - When claudeSessionId="abc123", data-testid="sessions-ctx-copy-id" is present.
 *  - When claudeSessionId is undefined, data-testid="sessions-ctx-copy-id" is absent.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContextMenu } from '../SessionContextMenu';

// ---------------------------------------------------------------------------
// Helper — render the menu and open it via right-click on the trigger
// ---------------------------------------------------------------------------

function renderAndOpen(props: {
  pinned: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  onRename?: () => void;
  onTags?: () => void;
  onArchive?: () => void;
  claudeSessionId?: string;
}) {
  render(
    <SessionContextMenu
      pinned={props.pinned}
      onPin={props.onPin ?? (() => undefined)}
      onUnpin={props.onUnpin ?? (() => undefined)}
      onRename={props.onRename ?? (() => undefined)}
      onTags={props.onTags ?? (() => undefined)}
      onArchive={props.onArchive ?? (() => undefined)}
      claudeSessionId={props.claudeSessionId}
    >
      <button type="button" data-testid="sessions-ctx-trigger">
        row
      </button>
    </SessionContextMenu>,
  );
  // Radix ContextMenu opens on a contextmenu (right-click) event
  fireEvent.contextMenu(screen.getByTestId('sessions-ctx-trigger'));
}

// ---------------------------------------------------------------------------
// 1. pinned=false → pin item renders text "Pin"
// ---------------------------------------------------------------------------

describe('SessionContextMenu — pin item text when pinned=false', () => {
  it('renders "Pin" (not "Unpin") in sessions-ctx-pin when pinned=false', () => {
    renderAndOpen({ pinned: false });
    const item = screen.getByTestId('sessions-ctx-pin');
    expect(item.textContent).toContain('Pin');
    expect(item.textContent).not.toContain('Unpin');
  });
});

// ---------------------------------------------------------------------------
// 2. pinned=true → pin item renders text "Unpin"
// ---------------------------------------------------------------------------

describe('SessionContextMenu — pin item text when pinned=true', () => {
  it('renders "Unpin" in sessions-ctx-pin when pinned=true', () => {
    renderAndOpen({ pinned: true });
    const item = screen.getByTestId('sessions-ctx-pin');
    expect(item.textContent).toContain('Unpin');
  });
});

// ---------------------------------------------------------------------------
// 3. Clicking pin item when pinned=false calls onPin once, NOT onUnpin
// ---------------------------------------------------------------------------

describe('SessionContextMenu — clicking pin item when pinned=false calls onPin', () => {
  it('calls onPin exactly once and not onUnpin when pinned=false', async () => {
    const onPin = vi.fn();
    const onUnpin = vi.fn();
    renderAndOpen({ pinned: false, onPin, onUnpin });

    await userEvent.click(screen.getByTestId('sessions-ctx-pin'));

    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onUnpin).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Clicking pin item when pinned=true calls onUnpin once, NOT onPin
// ---------------------------------------------------------------------------

describe('SessionContextMenu — clicking pin item when pinned=true calls onUnpin', () => {
  it('calls onUnpin exactly once and not onPin when pinned=true', async () => {
    const onPin = vi.fn();
    const onUnpin = vi.fn();
    renderAndOpen({ pinned: true, onPin, onUnpin });

    await userEvent.click(screen.getByTestId('sessions-ctx-pin'));

    expect(onUnpin).toHaveBeenCalledTimes(1);
    expect(onPin).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Rename item is always present and clicking it calls onRename once
// ---------------------------------------------------------------------------

describe('SessionContextMenu — rename item always present and calls onRename', () => {
  it('renders sessions-ctx-rename and calls onRename once when clicked', async () => {
    const onRename = vi.fn();
    renderAndOpen({ pinned: false, onRename });

    expect(screen.getByTestId('sessions-ctx-rename')).toBeTruthy();
    await userEvent.click(screen.getByTestId('sessions-ctx-rename'));

    expect(onRename).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Clicking archive item calls onArchive once
// ---------------------------------------------------------------------------

describe('SessionContextMenu — clicking archive item calls onArchive', () => {
  it('calls onArchive exactly once when sessions-ctx-archive is clicked', async () => {
    const onArchive = vi.fn();
    renderAndOpen({ pinned: false, onArchive });

    await userEvent.click(screen.getByTestId('sessions-ctx-archive'));

    expect(onArchive).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 7. claudeSessionId="abc123" → sessions-ctx-copy-id is present
// ---------------------------------------------------------------------------

describe('SessionContextMenu — copy-id item present when claudeSessionId is set', () => {
  it('renders sessions-ctx-copy-id when claudeSessionId="abc123"', () => {
    renderAndOpen({ pinned: false, claudeSessionId: 'abc123' });
    expect(screen.getByTestId('sessions-ctx-copy-id')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 8. claudeSessionId=undefined → sessions-ctx-copy-id is absent
// ---------------------------------------------------------------------------

describe('SessionContextMenu — copy-id item absent when claudeSessionId is undefined', () => {
  it('does not render sessions-ctx-copy-id when claudeSessionId is undefined', () => {
    renderAndOpen({ pinned: false, claudeSessionId: undefined });
    expect(screen.queryByTestId('sessions-ctx-copy-id')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Tags item is always present and clicking it calls onTags once
// ---------------------------------------------------------------------------

describe('SessionContextMenu — tags item always present and calls onTags', () => {
  it('renders sessions-ctx-tags and calls onTags exactly once when clicked', async () => {
    const onTags = vi.fn();
    renderAndOpen({ pinned: false, onTags });

    expect(screen.getByTestId('sessions-ctx-tags')).toBeTruthy();
    await userEvent.click(screen.getByTestId('sessions-ctx-tags'));

    expect(onTags).toHaveBeenCalledTimes(1);
  });
});
