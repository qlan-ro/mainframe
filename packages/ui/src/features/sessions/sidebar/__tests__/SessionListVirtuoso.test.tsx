/**
 * SessionListVirtuoso — behavior tests.
 *
 * react-virtuoso's GroupedVirtuoso measures layout and renders nothing under
 * jsdom (no real scroll viewport), so we mock the module with a fake
 * GroupedVirtuoso that synchronously invokes the real props it's given:
 * `components.Scroller` wraps the output, `groupContent(groupIndex)` runs
 * once per group, and `itemContent(flatIndex, groupIndex)` runs once per
 * flat item. This exercises SessionListVirtuoso's actual group/flat-index
 * wiring and the REAL SessionGroupHeader (not stubbed), while avoiding the
 * windowing engine itself (which has no meaningful behavior under jsdom).
 *
 * Behaviors covered:
 *  1. The `sessions-list-scroll` scroller test hook renders (from the real
 *     Scroller component SessionListVirtuoso passes in `components`).
 *  2. One `sessions-group-header-<label>` renders per group, via the real
 *     SessionGroupHeader.
 *  3. The Pinned group's header shows the pin glyph; a non-pinned group's does not.
 *  4. renderItem is invoked once per item, with `inPinnedGroup` true only for
 *     items under the 'Pinned' group, and `showProject` forwarded verbatim.
 *  5. groupCounts/flat-index mapping lines up: an item under group 0 gets
 *     group-0's flags, an item under group 1 gets group-1's flags — not a
 *     single global flag applied to everything.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';
import type { SessionGroupResult } from '../../view-model/group-sessions';

// ---------------------------------------------------------------------------
// Mock react-virtuoso's GroupedVirtuoso: synchronously drive the real props
// SessionListVirtuoso passes in, instead of doing any real windowing/layout.
// ---------------------------------------------------------------------------

vi.mock('react-virtuoso', () => ({
  GroupedVirtuoso: (props: {
    className?: string;
    style?: React.CSSProperties;
    groupCounts: number[];
    components: { Scroller: React.ComponentType<React.HTMLAttributes<HTMLDivElement>> };
    groupContent: (groupIndex: number) => React.ReactNode;
    itemContent: (index: number, groupIndex: number) => React.ReactNode;
  }) => {
    const { className, style, groupCounts, components, groupContent, itemContent } = props;
    const Scroller = components.Scroller;
    const rows: React.ReactNode[] = [];
    let flatIndex = 0;
    groupCounts.forEach((count, groupIndex) => {
      rows.push(<div key={`group-${groupIndex}`}>{groupContent(groupIndex)}</div>);
      for (let i = 0; i < count; i++) {
        rows.push(<div key={`item-${flatIndex}`}>{itemContent(flatIndex, groupIndex)}</div>);
        flatIndex++;
      }
    });
    // Real Virtuoso forwards the className/style it was given down to the Scroller
    // component (alongside its own marker class), which is how SessionListVirtuoso's
    // layout classes reach the ScrollArea Root. Mirror that, or the mock silently
    // swallows the very props some tests assert on.
    return (
      <Scroller className={['virtuoso-scroller', className].filter(Boolean).join(' ')} style={style}>
        {rows}
      </Scroller>
    );
  },
}));

const { SessionListVirtuoso } = await import('../SessionListVirtuoso');

// ---------------------------------------------------------------------------
// Fixture helpers
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
    transcriptMissing: false,
    updatedAt: 1749284160000,
  };
}

function makeItem(id: string): SessionItem {
  return { id, title: `Chat ${id}`, status: 'regular', custom: makeCustom() };
}

const PINNED_GROUP: SessionGroupResult = { label: 'Pinned', items: [makeItem('pin1')] };
const TODAY_GROUP: SessionGroupResult = { label: 'Today', items: [makeItem('t1'), makeItem('t2')] };

// ---------------------------------------------------------------------------
// 1. sessions-list-scroll renders (the real Scroller)
// ---------------------------------------------------------------------------

describe('SessionListVirtuoso — scroller test hook is present', () => {
  it('renders data-testid="sessions-list-scroll"', () => {
    render(
      <SessionListVirtuoso
        groups={[TODAY_GROUP]}
        showProject
        renderItem={(item) => <div key={item.id}>{item.id}</div>}
      />,
    );
    expect(screen.getByTestId('sessions-list-scroll')).toBeTruthy();
  });

  it('keeps the scrollbar gutter transparent while preserving Virtuoso classes', () => {
    render(
      <SessionListVirtuoso
        groups={[TODAY_GROUP]}
        showProject
        renderItem={(item) => <div key={item.id}>{item.id}</div>}
      />,
    );
    const viewport = screen.getByTestId('sessions-list-scroll');
    expect(viewport.className).toContain('bg-transparent');
    // Virtuoso passes the Scroller's className to the ScrollArea Root (the outermost
    // node it lays out), not to the Viewport that carries the test hook.
    expect(viewport.parentElement?.className).toContain('virtuoso-scroller');
  });

  // Regression: globals.css sets `scrollbar-width: thin` on `*`, which WebKit renders as a
  // CLASSIC, space-reserving scrollbar — the session list permanently lost a 13px gutter and rows
  // shrank (326px instead of 339px), even though the thumb is transparent at rest. Radix ScrollArea
  // is the fix: it hides the native bar and paints an absolutely-positioned thumb that overlays the
  // rows at zero layout cost. jsdom renders no scrollbars, so pin the structure that guarantees it —
  // Radix stamps `data-radix-scroll-area-viewport` on the viewport (and ships the scoped
  // `scrollbar-width:none` rule keyed off that attribute). A plain-div scroller has no such attr.
  it('renders the scroller as a Radix ScrollArea viewport so the native gutter is suppressed', () => {
    render(
      <SessionListVirtuoso
        groups={[TODAY_GROUP]}
        showProject
        renderItem={(item) => <div key={item.id}>{item.id}</div>}
      />,
    );
    const viewport = screen.getByTestId('sessions-list-scroll');
    expect(viewport.hasAttribute('data-radix-scroll-area-viewport')).toBe(true);
  });

  // Regression: the scroller's bottom gap must not be padding. The Root is capped at
  // `maxHeight: contentHeight` (Virtuoso's own measured content height) and is
  // border-box, so bottom padding is subtracted from the viewport INSIDE that cap:
  // a 272px Root gave a 270px viewport holding 272px of content (measured live:
  // vpOffsetH 270, vpScrollH 272, overflowBy 2). Radix read that phantom 2px
  // overflow as "scrollable" and painted a near-full-height thumb on a list that
  // comfortably fit. A margin sits outside the cap and buys the same gap for free.
  // jsdom does no layout, so pin the cause: no bottom padding on the Root, gap via margin.
  it('gives the scroller its bottom gap with a margin, never padding that fakes an overflow', () => {
    render(
      <SessionListVirtuoso
        groups={[TODAY_GROUP]}
        showProject
        renderItem={(item) => <div key={item.id}>{item.id}</div>}
      />,
    );
    // Virtuoso's className lands on the ScrollArea Root — the viewport's parent.
    const root = screen.getByTestId('sessions-list-scroll').parentElement;
    const rootClasses = root?.className.split(/\s+/) ?? [];
    expect(rootClasses).toContain('mb-0.5');
    expect(rootClasses.filter((c) => /^-?pb-/.test(c))).toEqual([]);
  });
});

it('renders sessions-group-header-Pinned and sessions-group-header-Today for two groups', () => {
  render(
    <SessionListVirtuoso
      groups={[PINNED_GROUP, TODAY_GROUP]}
      showProject
      renderItem={(item) => <div key={item.id}>{item.id}</div>}
    />,
  );
  expect(screen.getByTestId('sessions-group-header-Pinned')).toBeTruthy();
  expect(screen.getByTestId('sessions-group-header-Today')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 4 + 5. renderItem invoked once per item with correct { inPinnedGroup, showProject }
// per its OWN group — group-0 items get group-0's flags, group-1 items get
// group-1's flags. This is the flat-index → group-index mapping check.
// ---------------------------------------------------------------------------

describe('SessionListVirtuoso — renderItem receives correct per-group flags', () => {
  it('invokes renderItem once per item across all groups', () => {
    const renderItem = vi.fn((item: SessionItem) => <div key={item.id}>{item.id}</div>);
    render(<SessionListVirtuoso groups={[PINNED_GROUP, TODAY_GROUP]} showProject renderItem={renderItem} />);
    // 1 pinned item + 2 today items = 3 total invocations.
    expect(renderItem).toHaveBeenCalledTimes(3);
  });

  it('passes inPinnedGroup=true only for the item under the Pinned group', () => {
    const renderItem = vi.fn((item: SessionItem) => <div key={item.id}>{item.id}</div>);
    render(<SessionListVirtuoso groups={[PINNED_GROUP, TODAY_GROUP]} showProject renderItem={renderItem} />);

    expect(renderItem).toHaveBeenCalledWith(PINNED_GROUP.items[0], { inPinnedGroup: true, showProject: true });
    expect(renderItem).toHaveBeenCalledWith(TODAY_GROUP.items[0], { inPinnedGroup: false, showProject: true });
    expect(renderItem).toHaveBeenCalledWith(TODAY_GROUP.items[1], { inPinnedGroup: false, showProject: true });
  });

  it('forwards showProject=false verbatim to every item across every group', () => {
    const renderItem = vi.fn((item: SessionItem) => <div key={item.id}>{item.id}</div>);
    render(<SessionListVirtuoso groups={[PINNED_GROUP, TODAY_GROUP]} showProject={false} renderItem={renderItem} />);

    expect(renderItem).toHaveBeenCalledWith(PINNED_GROUP.items[0], { inPinnedGroup: true, showProject: false });
    expect(renderItem).toHaveBeenCalledWith(TODAY_GROUP.items[0], { inPinnedGroup: false, showProject: false });
  });

  it('maps flat indexes to the right group when a group other than the first has items', () => {
    // Only the Today group has items here (index 0 in groups, but exercises the
    // groupIndex plumbing independent of Pinned being present).
    const renderItem = vi.fn((item: SessionItem) => <div key={item.id}>{item.id}</div>);
    const OTHER_GROUP: SessionGroupResult = { label: 'Yesterday', items: [makeItem('y1')] };
    render(<SessionListVirtuoso groups={[TODAY_GROUP, OTHER_GROUP]} showProject renderItem={renderItem} />);

    // Item under group 0 (Today) -> inPinnedGroup false (not Pinned).
    expect(renderItem).toHaveBeenCalledWith(TODAY_GROUP.items[0], { inPinnedGroup: false, showProject: true });
    // Item under group 1 (Yesterday) -> also inPinnedGroup false, but must resolve
    // via groupIndex=1, not fall back to group 0's item.
    expect(renderItem).toHaveBeenCalledWith(OTHER_GROUP.items[0], { inPinnedGroup: false, showProject: true });
  });
});
