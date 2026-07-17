/**
 * SessionContextMenu — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - Pin item text switches between "Pin" and "Unpin" based on the pinned prop.
 *  - The copy-id item is present only when claudeSessionId is set.
 *  - Rename/tags items are always present.
 *  - Clicking pin/rename/archive/tags calls the matching handler exactly once
 *    (and pin never fires the opposite of onPin/onUnpin).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContextMenu } from '../SessionContextMenu';

function renderAndOpen(props: {
  pinned: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  onRename?: () => void;
  onTags?: () => void;
  onArchive?: () => void;
  claudeSessionId?: string;
}) {
  const result = render(
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
  return result;
}

describe('SessionContextMenu', () => {
  it('reflects pinned state and claudeSessionId availability in the rendered items', () => {
    const pinnedFalse = renderAndOpen({ pinned: false });
    expect(screen.getByTestId('sessions-ctx-pin').textContent).toContain('Pin');
    expect(screen.getByTestId('sessions-ctx-pin').textContent).not.toContain('Unpin');
    pinnedFalse.unmount();

    const pinnedTrue = renderAndOpen({ pinned: true });
    expect(screen.getByTestId('sessions-ctx-pin').textContent).toContain('Unpin');
    pinnedTrue.unmount();

    const withSessionId = renderAndOpen({ pinned: false, claudeSessionId: 'abc123' });
    expect(screen.getByTestId('sessions-ctx-copy-id')).toBeTruthy();
    withSessionId.unmount();

    renderAndOpen({ pinned: false, claudeSessionId: undefined });
    expect(screen.queryByTestId('sessions-ctx-copy-id')).toBeNull();
  });

  it.each([
    { testId: 'sessions-ctx-pin', pinned: false, expectCalled: 'onPin', expectNotCalled: 'onUnpin' },
    { testId: 'sessions-ctx-pin', pinned: true, expectCalled: 'onUnpin', expectNotCalled: 'onPin' },
    { testId: 'sessions-ctx-rename', pinned: false, expectCalled: 'onRename', expectNotCalled: undefined },
    { testId: 'sessions-ctx-archive', pinned: false, expectCalled: 'onArchive', expectNotCalled: undefined },
    { testId: 'sessions-ctx-tags', pinned: false, expectCalled: 'onTags', expectNotCalled: undefined },
  ] as const)(
    'clicking $testId (pinned=$pinned) calls $expectCalled exactly once',
    async ({ testId, pinned, expectCalled, expectNotCalled }) => {
      const spies = { onPin: vi.fn(), onUnpin: vi.fn(), onRename: vi.fn(), onTags: vi.fn(), onArchive: vi.fn() };
      renderAndOpen({ pinned, ...spies });

      expect(screen.getByTestId(testId)).toBeTruthy();
      await userEvent.click(screen.getByTestId(testId));

      expect(spies[expectCalled]).toHaveBeenCalledTimes(1);
      if (expectNotCalled) {
        expect(spies[expectNotCalled]).not.toHaveBeenCalled();
      }
    },
  );
});
