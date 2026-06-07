/**
 * SessionGroup — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  1. group.projectId="p1", collapsed does NOT contain "p1" → renders
 *     data-testid="sessions-group-p1".
 *  2. The header data-testid="sessions-group-header-p1" shows text "mainframe" and "3".
 *  3. When collapsed.has("p1") === true, the items container
 *     data-testid="sessions-group-items-p1" is absent from the DOM.
 *  4. When expanded (not collapsed), data-testid="sessions-group-items-p1" is
 *     present and renderItem is called once per item.
 *  5. Clicking data-testid="sessions-group-header-p1" calls toggle("p1") once.
 */
import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionGroup } from '../../view-model/group-sessions';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';

// ---------------------------------------------------------------------------
// Mutable collapse state — controlled per test via the mock below
// ---------------------------------------------------------------------------

let __collapsed = new Set<string>();
const toggleSpy = vi.fn();

vi.mock('../../useCollapsedProjects', () => ({
  useCollapsedProjects: () => ({
    collapsed: __collapsed,
    toggle: toggleSpy,
  }),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { SessionGroup: SessionGroupComponent } = await import('../SessionGroup');

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

function makeCustom(): SessionCustom {
  return {
    projectId: 'p1',
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status: 'active',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    updatedAt: 1749284160000,
  };
}

function makeItem(id: string): SessionItem {
  return { id, title: `Chat ${id}`, status: 'regular', custom: makeCustom() };
}

const THREE_ITEMS: SessionItem[] = [makeItem('c1'), makeItem('c2'), makeItem('c3')];

const GROUP: SessionGroup = {
  projectId: 'p1',
  projectName: 'mainframe',
  count: 3,
  items: THREE_ITEMS,
};

// ---------------------------------------------------------------------------
// 1. Root wrapper is in the DOM when not collapsed
// ---------------------------------------------------------------------------

describe('SessionGroup — root wrapper present when not collapsed', () => {
  it('renders data-testid="sessions-group-p1" when collapsed does not contain "p1"', () => {
    __collapsed = new Set();
    render(
      <SessionGroupComponent group={GROUP} renderItem={(item: SessionItem) => <div key={item.id}>{item.id}</div>} />,
    );
    expect(screen.getByTestId('sessions-group-p1')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Header shows project name and count
// ---------------------------------------------------------------------------

describe('SessionGroup — header shows projectName and count', () => {
  it('header contains text "mainframe" and "3"', () => {
    __collapsed = new Set();
    render(
      <SessionGroupComponent group={GROUP} renderItem={(item: SessionItem) => <div key={item.id}>{item.id}</div>} />,
    );
    const header = screen.getByTestId('sessions-group-header-p1');
    expect(header.textContent).toContain('mainframe');
    expect(header.textContent).toContain('3');
  });
});

// ---------------------------------------------------------------------------
// 3. Items container is absent when collapsed
// ---------------------------------------------------------------------------

describe('SessionGroup — items container absent when collapsed', () => {
  it('does not render sessions-group-items-p1 when collapsed.has("p1") is true', () => {
    __collapsed = new Set(['p1']);
    render(
      <SessionGroupComponent group={GROUP} renderItem={(item: SessionItem) => <div key={item.id}>{item.id}</div>} />,
    );
    expect(screen.queryByTestId('sessions-group-items-p1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Items container present and renderItem called once per item when expanded
// ---------------------------------------------------------------------------

describe('SessionGroup — items container present and renderItem called for each item', () => {
  it('renders sessions-group-items-p1 and calls renderItem 3 times when expanded', () => {
    __collapsed = new Set();
    const renderItem = vi.fn((item: SessionItem) => (
      <div key={item.id} data-testid={`item-${item.id}`}>
        {item.id}
      </div>
    )) as (item: SessionItem) => React.ReactNode;
    render(<SessionGroupComponent group={GROUP} renderItem={renderItem} />);
    expect(screen.getByTestId('sessions-group-items-p1')).toBeTruthy();
    expect(renderItem).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// 5. Clicking the header calls toggle("p1") once
// ---------------------------------------------------------------------------

describe('SessionGroup — clicking header calls toggle("p1")', () => {
  it('calls toggle with "p1" exactly once when header is clicked', async () => {
    __collapsed = new Set();
    toggleSpy.mockReset();
    render(
      <SessionGroupComponent group={GROUP} renderItem={(item: SessionItem) => <div key={item.id}>{item.id}</div>} />,
    );
    await userEvent.click(screen.getByTestId('sessions-group-header-p1'));
    expect(toggleSpy).toHaveBeenCalledTimes(1);
    expect(toggleSpy).toHaveBeenCalledWith('p1');
  });
});
