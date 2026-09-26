/**
 * SessionTabContextMenu — the tab's right-click menu. Covers the Fork item's
 * placement (AC 17: after the split item and Keep Open, before the Close
 * separator) and its enabled/disabled rendering off `forkAvailability`.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionTabContextMenu } from '../SessionTabContextMenu';
import type { ForkAvailability } from '@/features/sessions/view-model/fork-availability';

function renderMenu(
  overrides: Partial<{ inSplit: boolean; canOpenInSplit: boolean; preview: boolean }> = {},
  forkAvailability: ForkAvailability = { enabled: true },
  onFork = vi.fn(),
) {
  render(
    <TooltipProvider>
      <SessionTabContextMenu
        inSplit={overrides.inSplit ?? false}
        canOpenInSplit={overrides.canOpenInSplit ?? true}
        preview={overrides.preview ?? false}
        onOpenInSplit={vi.fn()}
        onCloseSplit={vi.fn()}
        onKeepOpen={vi.fn()}
        onClose={vi.fn()}
        forkAvailability={forkAvailability}
        onFork={onFork}
      >
        <div>tab</div>
      </SessionTabContextMenu>
    </TooltipProvider>,
  );
  fireEvent.contextMenu(screen.getByText('tab'));
}

describe('SessionTabContextMenu — Fork placement', () => {
  it('sits after Open in Split and before the Close separator, with no preview item', () => {
    renderMenu();

    const items = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(items).toEqual(['session-tab-ctx-open-split', 'session-tab-ctx-fork', 'session-tab-ctx-close']);
  });

  it('sits after Close Split when the tab is a split member', () => {
    renderMenu({ inSplit: true });

    const items = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(items).toEqual(['session-tab-ctx-close-split', 'session-tab-ctx-fork', 'session-tab-ctx-close']);
  });

  it('sits after Keep Open on a preview tab', () => {
    renderMenu({ preview: true });

    const items = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(items).toEqual([
      'session-tab-ctx-open-split',
      'session-tab-ctx-keep-open',
      'session-tab-ctx-fork',
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
