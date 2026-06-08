/**
 * TagFilterBar — behavior tests.
 *
 * Behaviors covered:
 *  1. tagsInUse=['alpha','beta'], both synthetics false → two tag pills rendered,
 *     no synthetic chip, no toggle button (hiddenCount=0).
 *  2. hasSynthetic('has-pr')=true → expand first, then sessions-tag-filter-synthetic-has-pr visible.
 *  3. hasSynthetic('has-worktree')=true → expand first, then sessions-tag-filter-synthetic-has-worktree visible.
 *  4. tagsInUse=[], both synthetics false → renders nothing (container.firstChild is null).
 *  5. Clicking sessions-tag-filter-alpha calls toggleTag('alpha') exactly once.
 *  6. Clicking sessions-tag-filter-synthetic-has-pr (after expanding) calls toggleSynthetic('has-pr') once.
 *  7. selectedTags contains 'alpha' → sessions-tag-filter-alpha has aria-pressed="true".
 *  8. selectedSynthetic contains 'has-pr' → sessions-tag-filter-synthetic-has-pr
 *     has aria-pressed="true" (after expanding).
 *  9. selectedTags is empty → sessions-tag-filter-alpha has aria-pressed="false".
 * 10. 6 tags, no synthetics → collapses to first 4; "+2 more" button present; e/f absent.
 * 11. After expanding 6 tags → e/f present, button reads "Less".
 * 12. Collapsing again after expanding → back to 4 + "+2 more".
 * 13. 1 tag + both synthetics true → collapsed shows tag + "+2 more", no synthetic chips.
 * 14. After expanding 1 tag + both synthetics → both synthetic chips present, button reads "Less".
 * 15. 2 tags, no synthetics → no toggle button (hiddenCount=0), both pills shown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import type { TagRegistry } from '../../tags/use-tag-registry';
import type { SessionItem } from '../../view-model/chat-to-thread-custom';
import type { SyntheticTag } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Controllable state for session-filters mock
// ---------------------------------------------------------------------------

let __selectedTags: Set<string> = new Set();
let __selectedSynthetic: Set<SyntheticTag> = new Set();
const toggleTagSpy = vi.fn();
const toggleSyntheticSpy = vi.fn();

vi.mock('../../../../store/session-filters', () => ({
  useSessionFilters: (
    selector: (s: {
      selectedTags: Set<string>;
      selectedSynthetic: Set<SyntheticTag>;
      toggleTag: (t: string) => void;
      toggleSynthetic: (s: SyntheticTag) => void;
    }) => unknown,
  ) =>
    selector({
      selectedTags: __selectedTags,
      selectedSynthetic: __selectedSynthetic,
      toggleTag: toggleTagSpy,
      toggleSynthetic: toggleSyntheticSpy,
    }),
}));

// ---------------------------------------------------------------------------
// Controllable state for tags-in-use mock
// ---------------------------------------------------------------------------

let __tagsInUseResult: string[] = [];
const __hasSyntheticResults: Record<string, boolean> = {
  'has-pr': false,
  'has-worktree': false,
};

vi.mock('../tags-in-use', () => ({
  tagsInUse: (_items: SessionItem[], _projectId: string | null): string[] => __tagsInUseResult,
  hasSynthetic: (_items: SessionItem[], kind: SyntheticTag): boolean => __hasSyntheticResults[kind] ?? false,
}));

// ---------------------------------------------------------------------------
// Fake registry — only colorOf is read
// ---------------------------------------------------------------------------

const fakeRegistry: TagRegistry = {
  tags: [],
  loading: false,
  refresh: async () => undefined,
  create: async () => undefined,
  update: async () => undefined,
  remove: async () => undefined,
  colorOf: (): TagColor => 'blue',
};

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import { TagFilterBar } from '../TagFilterBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_ITEMS: SessionItem[] = [];

function renderBar(filterProjectId: string | null = null) {
  return render(<TagFilterBar items={EMPTY_ITEMS} filterProjectId={filterProjectId} registry={fakeRegistry} />);
}

beforeEach(() => {
  __selectedTags = new Set();
  __selectedSynthetic = new Set();
  __tagsInUseResult = [];
  __hasSyntheticResults['has-pr'] = false;
  __hasSyntheticResults['has-worktree'] = false;
  toggleTagSpy.mockReset();
  toggleSyntheticSpy.mockReset();
});

// ---------------------------------------------------------------------------
// 1. Two tag pills; no synthetic chip when both synthetics are false
// ---------------------------------------------------------------------------

describe('TagFilterBar — renders tag pills for each tag in use', () => {
  it('renders sessions-tag-filter-alpha and sessions-tag-filter-beta when tagsInUse returns those two', () => {
    __tagsInUseResult = ['alpha', 'beta'];
    renderBar();
    expect(screen.getByTestId('sessions-tag-filter-alpha')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-beta')).toBeTruthy();
  });

  it('renders no synthetic chip when both hasSynthetic calls return false', () => {
    __tagsInUseResult = ['alpha', 'beta'];
    renderBar();
    expect(screen.queryByTestId('sessions-tag-filter-synthetic-has-pr')).toBeNull();
    expect(screen.queryByTestId('sessions-tag-filter-synthetic-has-worktree')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. has-pr synthetic chip appears when hasSynthetic('has-pr') is true (after expand)
// ---------------------------------------------------------------------------

describe('TagFilterBar — renders synthetic has-pr chip when hasSynthetic returns true', () => {
  it('shows sessions-tag-filter-synthetic-has-pr after expanding when has-pr=true', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    renderBar();
    // Synthetic chips are hidden until expanded; the toggle button must be present.
    fireEvent.click(screen.getByTestId('sessions-tag-filter-more'));
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-pr')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. has-worktree synthetic chip appears when hasSynthetic('has-worktree') is true (after expand)
// ---------------------------------------------------------------------------

describe('TagFilterBar — renders synthetic has-worktree chip when hasSynthetic returns true', () => {
  it('shows sessions-tag-filter-synthetic-has-worktree after expanding when has-worktree=true', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-worktree'] = true;
    renderBar();
    // Synthetic chips are hidden until expanded; the toggle button must be present.
    fireEvent.click(screen.getByTestId('sessions-tag-filter-more'));
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-worktree')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Renders nothing when tagsInUse=[] and both synthetics are false
// ---------------------------------------------------------------------------

describe('TagFilterBar — renders nothing when no tags and no synthetics', () => {
  it('container.firstChild is null when tagsInUse=[] and both synthetics=false', () => {
    __tagsInUseResult = [];
    __hasSyntheticResults['has-pr'] = false;
    __hasSyntheticResults['has-worktree'] = false;
    const { container } = renderBar();
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Clicking the alpha pill calls toggleTag('alpha') exactly once
// ---------------------------------------------------------------------------

describe('TagFilterBar — clicking tag pill calls toggleTag with tag name', () => {
  it("calls toggleTag('alpha') once when sessions-tag-filter-alpha is clicked", () => {
    __tagsInUseResult = ['alpha', 'beta'];
    renderBar();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-alpha'));
    expect(toggleTagSpy).toHaveBeenCalledTimes(1);
    expect(toggleTagSpy).toHaveBeenCalledWith('alpha');
  });
});

// ---------------------------------------------------------------------------
// 6. Clicking the has-pr synthetic chip calls toggleSynthetic('has-pr') once (after expand)
// ---------------------------------------------------------------------------

describe("TagFilterBar — clicking synthetic chip calls toggleSynthetic with 'has-pr'", () => {
  it("calls toggleSynthetic('has-pr') once when sessions-tag-filter-synthetic-has-pr is clicked", () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    renderBar();
    // Must expand before the synthetic chip is in the document.
    fireEvent.click(screen.getByTestId('sessions-tag-filter-more'));
    fireEvent.click(screen.getByTestId('sessions-tag-filter-synthetic-has-pr'));
    expect(toggleSyntheticSpy).toHaveBeenCalledTimes(1);
    expect(toggleSyntheticSpy).toHaveBeenCalledWith('has-pr');
  });
});

// ---------------------------------------------------------------------------
// 7. alpha pill has aria-pressed="true" when selectedTags contains 'alpha'
// ---------------------------------------------------------------------------

describe('TagFilterBar — aria-pressed="true" when tag is in selectedTags', () => {
  it('sessions-tag-filter-alpha has aria-pressed="true" when selectedTags contains alpha', () => {
    __tagsInUseResult = ['alpha'];
    __selectedTags = new Set(['alpha']);
    renderBar();
    expect(screen.getByTestId('sessions-tag-filter-alpha')).toHaveAttribute('aria-pressed', 'true');
  });
});

// ---------------------------------------------------------------------------
// 8. has-pr chip has aria-pressed="true" when selectedSynthetic contains 'has-pr' (after expand)
// ---------------------------------------------------------------------------

describe('TagFilterBar — aria-pressed="true" when synthetic is in selectedSynthetic', () => {
  it('sessions-tag-filter-synthetic-has-pr has aria-pressed="true" when selectedSynthetic contains \'has-pr\'', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    __selectedSynthetic = new Set<SyntheticTag>(['has-pr']);
    renderBar();
    // Expand to reveal the synthetic chip.
    fireEvent.click(screen.getByTestId('sessions-tag-filter-more'));
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-pr')).toHaveAttribute('aria-pressed', 'true');
  });
});

// ---------------------------------------------------------------------------
// 9. alpha pill has aria-pressed="false" when selectedTags is empty
// ---------------------------------------------------------------------------

describe('TagFilterBar — aria-pressed="false" when tag is not in selectedTags', () => {
  it('sessions-tag-filter-alpha has aria-pressed="false" when selectedTags is empty', () => {
    __tagsInUseResult = ['alpha'];
    __selectedTags = new Set();
    renderBar();
    expect(screen.getByTestId('sessions-tag-filter-alpha')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---------------------------------------------------------------------------
// 10–12. Collapse / expand with 6 tags and no synthetics
// ---------------------------------------------------------------------------

describe('TagFilterBar — collapses to first 4 tags when 6 are in use', () => {
  it('shows only a,b,c,d and hides e,f with "+2 more" button when collapsed', () => {
    __tagsInUseResult = ['a', 'b', 'c', 'd', 'e', 'f'];
    renderBar();
    expect(screen.getByTestId('sessions-tag-filter-a')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-b')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-c')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-d')).toBeTruthy();
    expect(screen.queryByTestId('sessions-tag-filter-e')).toBeNull();
    expect(screen.queryByTestId('sessions-tag-filter-f')).toBeNull();
    expect(screen.getByTestId('sessions-tag-filter-more').textContent).toBe('+2 more');
  });

  it('renders the collapsed overflow control as accent text, not a filled pill', () => {
    __tagsInUseResult = ['a', 'b', 'c', 'd', 'e', 'f'];
    renderBar();
    const more = screen.getByTestId('sessions-tag-filter-more');
    expect(more.className).toContain('text-primary');
    expect(more.className).not.toContain('bg-accent');
    expect(more.className).not.toContain('rounded-[11px]');
  });

  it('shows all 6 tags and button reads "Less" after clicking the toggle', () => {
    __tagsInUseResult = ['a', 'b', 'c', 'd', 'e', 'f'];
    renderBar();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-more'));
    expect(screen.getByTestId('sessions-tag-filter-e')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-f')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-more').textContent).toBe('Less');
  });

  it('collapses back to 4 tags and "+2 more" after clicking the toggle a second time', () => {
    __tagsInUseResult = ['a', 'b', 'c', 'd', 'e', 'f'];
    renderBar();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-more'));
    fireEvent.click(screen.getByTestId('sessions-tag-filter-more'));
    expect(screen.queryByTestId('sessions-tag-filter-e')).toBeNull();
    expect(screen.queryByTestId('sessions-tag-filter-f')).toBeNull();
    expect(screen.getByTestId('sessions-tag-filter-more').textContent).toBe('+2 more');
  });
});

// ---------------------------------------------------------------------------
// 13–14. Collapse / expand with 1 tag + both synthetics true
// ---------------------------------------------------------------------------

describe('TagFilterBar — collapses synthetic chips behind toggle when 1 tag + 2 synthetics', () => {
  it('shows tag pill + "+2 more" button but NO synthetic chips when collapsed', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    __hasSyntheticResults['has-worktree'] = true;
    renderBar();
    expect(screen.getByTestId('sessions-tag-filter-alpha')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-more').textContent).toBe('+2 more');
    expect(screen.queryByTestId('sessions-tag-filter-synthetic-has-pr')).toBeNull();
    expect(screen.queryByTestId('sessions-tag-filter-synthetic-has-worktree')).toBeNull();
  });

  it('shows both synthetic chips and button reads "Less" after expanding', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    __hasSyntheticResults['has-worktree'] = true;
    renderBar();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-more'));
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-pr')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-worktree')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-more').textContent).toBe('Less');
  });
});

// ---------------------------------------------------------------------------
// 15. No toggle button when hiddenCount is 0 (2 tags, no synthetics)
// ---------------------------------------------------------------------------

describe('TagFilterBar — no toggle button when hiddenCount is 0', () => {
  it('does NOT render sessions-tag-filter-more when only 2 tags and no synthetics', () => {
    __tagsInUseResult = ['alpha', 'beta'];
    renderBar();
    expect(screen.queryByTestId('sessions-tag-filter-more')).toBeNull();
    expect(screen.getByTestId('sessions-tag-filter-alpha')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-beta')).toBeTruthy();
  });
});
