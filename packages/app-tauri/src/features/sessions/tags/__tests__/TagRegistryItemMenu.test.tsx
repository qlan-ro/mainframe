/**
 * TagRegistryItemMenu — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  1. Right-clicking children opens the menu; sessions-tag-registry-row-alpha
 *     (the children trigger) is rendered.
 *  2. After right-click, sessions-tag-registry-rename renders text "Rename".
 *  3. After right-click, sessions-tag-registry-recolor renders text "Change color".
 *  4. After right-click, sessions-tag-registry-delete renders text
 *     "Delete from all sessions".
 *  5. Clicking sessions-tag-registry-rename calls onRename('alpha') exactly once.
 *  6. Clicking sessions-tag-registry-recolor calls onRecolor('alpha') exactly once.
 *  7. Clicking sessions-tag-registry-delete calls onDelete('alpha') exactly once.
 */
import { describe, it, expect, vi } from 'vitest';
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

// ---------------------------------------------------------------------------
// 1. Children trigger is rendered
// ---------------------------------------------------------------------------

describe('TagRegistryItemMenu — renders children as the trigger', () => {
  it('renders sessions-tag-registry-row-alpha as the trigger', () => {
    renderAndOpen({});
    expect(screen.getByTestId('sessions-tag-registry-row-alpha')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Rename item renders text "Rename"
// ---------------------------------------------------------------------------

describe('TagRegistryItemMenu — rename item renders text "Rename"', () => {
  it('sessions-tag-registry-rename has text content "Rename"', () => {
    renderAndOpen({});
    const item = screen.getByTestId('sessions-tag-registry-rename');
    expect(item.textContent).toBe('Rename');
  });
});

// ---------------------------------------------------------------------------
// 3. Recolor item renders text "Change color"
// ---------------------------------------------------------------------------

describe('TagRegistryItemMenu — recolor item renders text "Change color"', () => {
  it('sessions-tag-registry-recolor has text content "Change color"', () => {
    renderAndOpen({});
    const item = screen.getByTestId('sessions-tag-registry-recolor');
    expect(item.textContent).toBe('Change color');
  });
});

// ---------------------------------------------------------------------------
// 4. Delete item renders text "Delete from all sessions"
// ---------------------------------------------------------------------------

describe('TagRegistryItemMenu — delete item renders text "Delete from all sessions"', () => {
  it('sessions-tag-registry-delete has text content "Delete from all sessions"', () => {
    renderAndOpen({});
    const item = screen.getByTestId('sessions-tag-registry-delete');
    expect(item.textContent).toBe('Delete from all sessions');
  });
});

// ---------------------------------------------------------------------------
// 5. Clicking rename item calls onRename('alpha') exactly once
// ---------------------------------------------------------------------------

describe("TagRegistryItemMenu — clicking rename calls onRename('alpha') once", () => {
  it("calls onRename with 'alpha' exactly once when sessions-tag-registry-rename is clicked", async () => {
    const onRename = vi.fn();
    renderAndOpen({ onRename });

    await userEvent.click(screen.getByTestId('sessions-tag-registry-rename'));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('alpha');
  });
});

// ---------------------------------------------------------------------------
// 6. Clicking recolor item calls onRecolor('alpha') exactly once
// ---------------------------------------------------------------------------

describe("TagRegistryItemMenu — clicking recolor calls onRecolor('alpha') once", () => {
  it("calls onRecolor with 'alpha' exactly once when sessions-tag-registry-recolor is clicked", async () => {
    const onRecolor = vi.fn();
    renderAndOpen({ onRecolor });

    await userEvent.click(screen.getByTestId('sessions-tag-registry-recolor'));

    expect(onRecolor).toHaveBeenCalledTimes(1);
    expect(onRecolor).toHaveBeenCalledWith('alpha');
  });
});

// ---------------------------------------------------------------------------
// 7. Clicking delete item calls onDelete('alpha') exactly once
// ---------------------------------------------------------------------------

describe("TagRegistryItemMenu — clicking delete calls onDelete('alpha') once", () => {
  it("calls onDelete with 'alpha' exactly once when sessions-tag-registry-delete is clicked", async () => {
    const onDelete = vi.fn();
    renderAndOpen({ onDelete });

    await userEvent.click(screen.getByTestId('sessions-tag-registry-delete'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('alpha');
  });
});
