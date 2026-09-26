/**
 * SessionContextMenu — behavior tests (todo #346).
 *
 * A temporary row's Pin and Tags menu items are hidden (the daemon 409s them)
 * and its Archive item relabels to "Discard".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContextMenu } from '../SessionContextMenu';

function renderMenu(temporary: boolean) {
  render(
    <SessionContextMenu
      pinned={false}
      temporary={temporary}
      onPin={vi.fn()}
      onUnpin={vi.fn()}
      onRename={vi.fn()}
      onTags={vi.fn()}
      onArchive={vi.fn()}
      onOpenInSplit={vi.fn()}
    >
      <div data-testid="row-trigger">row</div>
    </SessionContextMenu>,
  );
}

async function openMenu() {
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('row-trigger') });
}

describe('SessionContextMenu — non-temporary row', () => {
  it('shows Pin and Tags, and labels the archive item "Archive"', async () => {
    renderMenu(false);
    await openMenu();

    expect(screen.getByTestId('sessions-ctx-pin')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-ctx-tags')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-ctx-archive').textContent).toContain('Archive');
  });
});

describe('SessionContextMenu — temporary row (todo #346)', () => {
  it('hides Pin and Tags', async () => {
    renderMenu(true);
    await openMenu();

    expect(screen.queryByTestId('sessions-ctx-pin')).toBeNull();
    expect(screen.queryByTestId('sessions-ctx-tags')).toBeNull();
  });

  it('relabels the archive item to "Discard"', async () => {
    renderMenu(true);
    await openMenu();

    expect(screen.getByTestId('sessions-ctx-archive').textContent).toContain('Discard');
  });

  it('still shows Rename and Open in Split', async () => {
    renderMenu(true);
    await openMenu();

    expect(screen.getByTestId('sessions-ctx-rename')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-ctx-open-split')).toBeInTheDocument();
  });
});
