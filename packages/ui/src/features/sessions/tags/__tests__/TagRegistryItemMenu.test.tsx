/**
 * TagRegistryItemMenu — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  1. Right-clicking children opens the menu; sessions-tag-registry-row-alpha
 *     (the children trigger) is rendered.
 *  2. After right-click, each item renders its label: Rename / Change color /
 *     Delete from all sessions.
 *  3. Clicking each item calls the matching handler (onRename/onRecolor/
 *     onDelete) with the tag name exactly once.
 */
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagRegistryItemMenu } from '../TagRegistryItemMenu';

// ---------------------------------------------------------------------------
// Helper — render the menu and open it via right-click on the trigger
// ---------------------------------------------------------------------------

function renderAndOpen(props: {
  tagName?: string;
  onRename?: (name: string) => void;
  onRecolor?: (name: string) => void;
  onDelete?: (name: string) => void;
}) {
  const tagName = props.tagName ?? 'alpha';
  render(
    <TagRegistryItemMenu
      tagName={tagName}
      onRename={props.onRename ?? (() => undefined)}
      onRecolor={props.onRecolor ?? (() => undefined)}
      onDelete={props.onDelete ?? (() => undefined)}
    >
      <div data-testid="sessions-tag-registry-row-alpha">tag row</div>
    </TagRegistryItemMenu>,
  );
  // Radix ContextMenu opens on a contextmenu (right-click) event
  fireEvent.contextMenu(screen.getByTestId('sessions-tag-registry-row-alpha'));
}

it('renders the children as the context-menu trigger', () => {
  renderAndOpen({});
  expect(screen.getByTestId('sessions-tag-registry-row-alpha')).toBeTruthy();
});

it('renders each item label after right-click: Rename, Change color, Delete from all sessions', () => {
  renderAndOpen({});

  expect(screen.getByTestId('sessions-tag-registry-rename').textContent).toBe('Rename');
  expect(screen.getByTestId('sessions-tag-registry-recolor').textContent).toBe('Change color');
  expect(screen.getByTestId('sessions-tag-registry-delete').textContent).toBe('Delete from all sessions');
});

it.each([
  { testId: 'sessions-tag-registry-rename', propName: 'onRename' as const },
  { testId: 'sessions-tag-registry-recolor', propName: 'onRecolor' as const },
  { testId: 'sessions-tag-registry-delete', propName: 'onDelete' as const },
])('clicking $testId calls $propName with the tag name exactly once', async ({ testId, propName }) => {
  const handler = vi.fn();
  renderAndOpen({ [propName]: handler });

  await userEvent.click(screen.getByTestId(testId));

  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith('alpha');
});
