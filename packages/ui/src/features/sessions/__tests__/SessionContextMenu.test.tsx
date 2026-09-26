/**
 * SessionContextMenu — the sidebar row's right-click menu. Covers the Fork
 * item's placement (AC 17: after Open in Split, before the Archive separator),
 * its enabled/disabled rendering off `forkAvailability`, and a temporary row's
 * menu (todo #346): no Pin or Tags, and Archive relabelled "Discard".
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionContextMenu } from '../SessionContextMenu';
import type { ForkAvailability } from '../view-model/fork-availability';

const BASE_PROPS = {
  pinned: false,
  temporary: false,
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onRename: vi.fn(),
  onTags: vi.fn(),
  onArchive: vi.fn(),
  onOpenInSplit: vi.fn(),
  onFork: vi.fn(),
};

function renderMenu(forkAvailability: ForkAvailability, onFork = vi.fn(), temporary = false) {
  render(
    <TooltipProvider>
      <SessionContextMenu {...BASE_PROPS} temporary={temporary} onFork={onFork} forkAvailability={forkAvailability}>
        <div>row</div>
      </SessionContextMenu>
    </TooltipProvider>,
  );
  fireEvent.contextMenu(screen.getByText('row'));
}

describe('SessionContextMenu — Fork placement', () => {
  it('sits between Open in Split and the separator above Archive', () => {
    renderMenu({ enabled: true });

    const items = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    const splitIndex = items.indexOf('sessions-ctx-open-split');
    const forkIndex = items.indexOf('sessions-ctx-fork');
    const archiveIndex = items.indexOf('sessions-ctx-archive');

    expect(forkIndex).toBe(splitIndex + 1);
    expect(forkIndex).toBeLessThan(archiveIndex);
  });
});

describe('SessionContextMenu — Fork enabled', () => {
  it('is not disabled and activating it calls onFork', () => {
    const onFork = vi.fn();
    renderMenu({ enabled: true }, onFork);

    const fork = screen.getByTestId('sessions-ctx-fork');
    expect(fork).not.toHaveAttribute('data-disabled');

    fireEvent.click(fork);
    expect(onFork).toHaveBeenCalledTimes(1);
  });
});

describe('SessionContextMenu — Fork disabled', () => {
  it.each([
    "Forking isn't available for Codex chats yet",
    'Nothing to fork yet',
    "This chat's transcript is missing",
    "This chat's folder is missing",
    'Wait for the current turn to finish or interrupt it',
  ])('renders disabled with the exact Hint reason: %s', (reason) => {
    const onFork = vi.fn();
    renderMenu({ enabled: false, reason }, onFork);

    const fork = screen.getByTestId('sessions-ctx-fork');
    expect(fork).toHaveAttribute('data-disabled');

    fireEvent.click(fork);
    expect(onFork).not.toHaveBeenCalled();
  });
});

describe('SessionContextMenu — non-temporary row', () => {
  it('shows Pin and Tags, and labels the archive item "Archive"', () => {
    renderMenu({ enabled: true });

    expect(screen.getByTestId('sessions-ctx-pin')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-ctx-tags')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-ctx-archive').textContent).toContain('Archive');
  });
});

describe('SessionContextMenu — temporary row (todo #346)', () => {
  it('hides Pin and Tags', () => {
    renderMenu({ enabled: true }, vi.fn(), true);

    expect(screen.queryByTestId('sessions-ctx-pin')).toBeNull();
    expect(screen.queryByTestId('sessions-ctx-tags')).toBeNull();
  });

  it('relabels the archive item to "Discard"', () => {
    renderMenu({ enabled: true }, vi.fn(), true);

    expect(screen.getByTestId('sessions-ctx-archive').textContent).toContain('Discard');
  });

  it('still shows Rename and Open in Split', () => {
    renderMenu({ enabled: true }, vi.fn(), true);

    expect(screen.getByTestId('sessions-ctx-rename')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-ctx-open-split')).toBeInTheDocument();
  });
});
