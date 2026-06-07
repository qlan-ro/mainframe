/**
 * SessionGroup — generic group-section behavior tests.
 *
 * SessionGroup is now a non-collapsible, sticky-header section keyed by a free
 * label (Pinned / Today / Yesterday / Earlier / A–Z / By status) — NOT a
 * collapsible project group. Behaviors covered:
 *  1. Renders a sticky header showing the label.
 *  2. The Pinned group shows a pin glyph in its header; other groups do not.
 *  3. renderItem is called once per item, receiving inPinnedGroup + showProject.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';
import type { SessionGroupResult } from '../../view-model/group-sessions';
import { SessionGroup } from '../SessionGroup';

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

const TODAY_GROUP: SessionGroupResult = {
  label: 'Today',
  items: [makeItem('c1'), makeItem('c2'), makeItem('c3')],
};

const PINNED_GROUP: SessionGroupResult = {
  label: 'Pinned',
  items: [makeItem('p1')],
};

describe('SessionGroup — sticky header shows the label', () => {
  it('renders the group label text in the header', () => {
    render(<SessionGroup group={TODAY_GROUP} showProject renderItem={(item) => <div key={item.id}>{item.id}</div>} />);
    const header = screen.getByTestId('sessions-group-header-Today');
    expect(header.textContent).toContain('Today');
  });
});

describe('SessionGroup — pin glyph only in the Pinned group', () => {
  it('shows a pin glyph in the Pinned group header', () => {
    render(<SessionGroup group={PINNED_GROUP} showProject renderItem={(item) => <div key={item.id}>{item.id}</div>} />);
    expect(screen.getByTestId('sessions-group-pin-glyph')).toBeTruthy();
  });

  it('does not show a pin glyph in a non-Pinned group header', () => {
    render(<SessionGroup group={TODAY_GROUP} showProject renderItem={(item) => <div key={item.id}>{item.id}</div>} />);
    expect(screen.queryByTestId('sessions-group-pin-glyph')).toBeNull();
  });
});

describe('SessionGroup — renderItem invoked per item with group flags', () => {
  it('calls renderItem once per item', () => {
    const renderItem = vi.fn((item: SessionItem) => <div key={item.id}>{item.id}</div>) as (
      item: SessionItem,
      flags: { inPinnedGroup: boolean; showProject: boolean },
    ) => React.ReactNode;
    render(<SessionGroup group={TODAY_GROUP} showProject renderItem={renderItem} />);
    expect(renderItem).toHaveBeenCalledTimes(3);
  });

  it('passes inPinnedGroup=true and the showProject flag to renderItem for the Pinned group', () => {
    const renderItem = vi.fn((item: SessionItem) => <div key={item.id}>{item.id}</div>) as (
      item: SessionItem,
      flags: { inPinnedGroup: boolean; showProject: boolean },
    ) => React.ReactNode;
    render(<SessionGroup group={PINNED_GROUP} showProject={false} renderItem={renderItem} />);
    expect(renderItem).toHaveBeenCalledWith(PINNED_GROUP.items[0], { inPinnedGroup: true, showProject: false });
  });

  it('passes inPinnedGroup=false for a time group', () => {
    const renderItem = vi.fn((item: SessionItem) => <div key={item.id}>{item.id}</div>) as (
      item: SessionItem,
      flags: { inPinnedGroup: boolean; showProject: boolean },
    ) => React.ReactNode;
    render(<SessionGroup group={TODAY_GROUP} showProject renderItem={renderItem} />);
    expect(renderItem).toHaveBeenCalledWith(TODAY_GROUP.items[0], { inPinnedGroup: false, showProject: true });
  });
});
