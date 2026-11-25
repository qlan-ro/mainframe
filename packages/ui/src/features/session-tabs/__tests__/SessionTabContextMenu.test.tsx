/**
 * SessionTabContextMenu — the tab's right-click menu. Covers the Fork item's
 * placement (AC 17: after Open in Workspace and Keep Open, before the Close
 * separator) and its enabled/disabled rendering off `forkAvailability`, plus
 * the surface-wide action (Hide Chat) that moved here from
 * the retired chat header — rendered after a separator, before Close.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionTabContextMenu, type SurfaceMenuActions } from '../SessionTabContextMenu';
import type { ForkAvailability } from '@/features/sessions/view-model/fork-availability';

function defaultSurface(overrides: Partial<SurfaceMenuActions> = {}): SurfaceMenuActions {
  return {
    canHide: true,
    onHide: vi.fn(),
    ...overrides,
  };
}

function renderMenu(
  overrides: Partial<{
    canOpenBeside: boolean;
    preview: boolean;
    canOpenSideChat: boolean;
    onOpenSideChat: () => void;
    surface: SurfaceMenuActions;
  }> = {},
  forkAvailability: ForkAvailability = { enabled: true },
  onFork = vi.fn(),
) {
  render(
    <TooltipProvider>
      <SessionTabContextMenu
        canOpenBeside={overrides.canOpenBeside ?? true}
        preview={overrides.preview ?? false}
        onOpenBeside={vi.fn()}
        onKeepOpen={vi.fn()}
        onClose={vi.fn()}
        forkAvailability={forkAvailability}
        onFork={onFork}
        canOpenSideChat={overrides.canOpenSideChat ?? false}
        onOpenSideChat={overrides.onOpenSideChat ?? vi.fn()}
        surface={overrides.surface ?? defaultSurface()}
      >
        <div>tab</div>
      </SessionTabContextMenu>
    </TooltipProvider>,
  );
  fireEvent.contextMenu(screen.getByText('tab'));
}

describe('SessionTabContextMenu — Fork placement', () => {
  it('sits after Open in Workspace and before the Close separator, with no preview item', () => {
    renderMenu();

    const items = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(items).toEqual([
      'session-tab-ctx-open-workspace',
      'session-tab-ctx-fork',
      'session-tab-ctx-hide-chat',
      'session-tab-ctx-close',
    ]);
  });

  it('sits after Keep Open on a preview tab', () => {
    renderMenu({ preview: true });

    const items = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(items).toEqual([
      'session-tab-ctx-open-workspace',
      'session-tab-ctx-keep-open',
      'session-tab-ctx-fork',
      'session-tab-ctx-hide-chat',
      'session-tab-ctx-close',
    ]);
  });
});

describe('SessionTabContextMenu — Fork enabled', () => {
  it('is not disabled and activating it calls onFork', () => {
    const onFork = vi.fn();
    renderMenu({}, { enabled: true }, onFork);

    const fork = screen.getByTestId('session-tab-ctx-fork');
    expect(fork).not.toHaveAttribute('data-disabled');

    fireEvent.click(fork);
    expect(onFork).toHaveBeenCalledTimes(1);
  });
});

describe('SessionTabContextMenu — Fork disabled', () => {
  it.each([
    "Forking isn't available for Codex chats yet",
    'Nothing to fork yet',
    'Wait for the current turn to finish or interrupt it',
  ])('renders disabled with the exact Hint reason: %s', (reason) => {
    const onFork = vi.fn();
    renderMenu({}, { enabled: false, reason }, onFork);

    const fork = screen.getByTestId('session-tab-ctx-fork');
    expect(fork).toHaveAttribute('data-disabled');

    fireEvent.click(fork);
    expect(onFork).not.toHaveBeenCalled();
  });
});

describe('SessionTabContextMenu — Open Side Chat (todo #344)', () => {
  it('renders for a regular tab and calls onOpenSideChat when selected', () => {
    const onOpenSideChat = vi.fn();
    renderMenu({ canOpenSideChat: true, onOpenSideChat });

    const item = screen.getByTestId('session-tab-ctx-side-chat');
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onOpenSideChat).toHaveBeenCalledTimes(1);
  });

  it('is hidden for a draft tab (canOpenSideChat false)', () => {
    renderMenu({ canOpenSideChat: false });

    expect(screen.queryByTestId('session-tab-ctx-side-chat')).toBeNull();
  });
});

describe('SessionTabContextMenu — surface actions (moved from the retired chat header)', () => {
  it('enables Hide Chat and calls onHide when the surface is not at the floor', () => {
    const onHide = vi.fn();
    renderMenu({ surface: defaultSurface({ canHide: true, onHide }) });

    const hideChat = screen.getByTestId('session-tab-ctx-hide-chat');
    expect(hideChat).not.toHaveAttribute('data-disabled');

    fireEvent.click(hideChat);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('disables Hide Chat and does not call onHide when the surface is the floor', () => {
    const onHide = vi.fn();
    renderMenu({ surface: defaultSurface({ canHide: false, onHide }) });

    const hideChat = screen.getByTestId('session-tab-ctx-hide-chat');
    expect(hideChat).toHaveAttribute('data-disabled');

    fireEvent.click(hideChat);
    expect(onHide).not.toHaveBeenCalled();
  });
});
