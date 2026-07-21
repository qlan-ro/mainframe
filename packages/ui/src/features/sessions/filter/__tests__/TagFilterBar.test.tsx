/**
 * TagFilterBar — behavior tests.
 *
 * Behaviors covered:
 *  1. tagsInUse=['alpha','beta'], both synthetics false → two tag pills rendered,
 *     no synthetic chip.
 *  2. hasSynthetic('has-pr')=true → sessions-tag-filter-synthetic-has-pr visible
 *     immediately (no expand step — everything always renders).
 *  3. hasSynthetic('has-worktree')=true → sessions-tag-filter-synthetic-has-worktree
 *     visible immediately.
 *  4. tagsInUse=[], both synthetics false → renders nothing (container.firstChild is null).
 *  5. Clicking sessions-tag-filter-alpha calls toggleTag('alpha') exactly once.
 *  6. Clicking sessions-tag-filter-synthetic-has-pr calls toggleSynthetic('has-pr') once.
 *  7. selectedTags contains 'alpha' → sessions-tag-filter-alpha has aria-pressed="true".
 *  8. selectedSynthetic contains 'has-pr' → sessions-tag-filter-synthetic-has-pr
 *     has aria-pressed="true".
 *  9. selectedTags is empty → sessions-tag-filter-alpha has aria-pressed="false".
 * 10. 6 tags, no synthetics → all 6 render at once, no "+N more" toggle ever appears.
 * 11. The pill grid wraps (flex-wrap) and caps its height (TAG_GRID_MAX_HEIGHT_PX)
 *     with its own scroll instead of truncating.
 * 12. The section is collapsible via a chevron toggle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import type { TagRegistry } from '../../tags/use-tag-registry';
import type { SessionItem } from '../../view-model/chat-to-thread-custom';
import type { SyntheticTag } from '@qlan-ro/mainframe-types';
import { useUiPrefs } from '@/store/ui-prefs';

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
  useUiPrefs.setState({ collapsedSidebarSections: {} });
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
// 2-3. Synthetic chips render immediately — no expand step
// ---------------------------------------------------------------------------

describe('TagFilterBar — renders synthetic chips immediately when hasSynthetic returns true', () => {
  it('shows sessions-tag-filter-synthetic-has-pr with no prior interaction when has-pr=true', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    renderBar();
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-pr')).toBeTruthy();
  });

  it('shows sessions-tag-filter-synthetic-has-worktree with no prior interaction when has-worktree=true', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-worktree'] = true;
    renderBar();
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
// 6. Clicking the has-pr synthetic chip calls toggleSynthetic('has-pr') once
// ---------------------------------------------------------------------------

describe("TagFilterBar — clicking synthetic chip calls toggleSynthetic with 'has-pr'", () => {
  it("calls toggleSynthetic('has-pr') once when sessions-tag-filter-synthetic-has-pr is clicked", () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    renderBar();
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
// 8. has-pr chip has aria-pressed="true" when selectedSynthetic contains 'has-pr'
// ---------------------------------------------------------------------------

describe('TagFilterBar — aria-pressed="true" when synthetic is in selectedSynthetic', () => {
  it('sessions-tag-filter-synthetic-has-pr has aria-pressed="true" when selectedSynthetic contains \'has-pr\'', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    __selectedSynthetic = new Set<SyntheticTag>(['has-pr']);
    renderBar();
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
// 10. All tags render at once; no "+N more" toggle ever appears
// ---------------------------------------------------------------------------

describe('TagFilterBar — renders every tag at once, no overflow toggle', () => {
  it('renders all 6 tags with no sessions-tag-filter-more button', () => {
    __tagsInUseResult = ['a', 'b', 'c', 'd', 'e', 'f'];
    renderBar();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(screen.getByTestId(`sessions-tag-filter-${name}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('sessions-tag-filter-more')).toBeNull();
  });

  it('renders synthetic chips alongside tags with no overflow toggle', () => {
    __tagsInUseResult = ['alpha'];
    __hasSyntheticResults['has-pr'] = true;
    __hasSyntheticResults['has-worktree'] = true;
    renderBar();
    expect(screen.getByTestId('sessions-tag-filter-alpha')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-pr')).toBeTruthy();
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-worktree')).toBeTruthy();
    expect(screen.queryByTestId('sessions-tag-filter-more')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. The grid wraps and caps its height with its own scroll
// ---------------------------------------------------------------------------

describe('TagFilterBar — grid wraps and caps height instead of truncating', () => {
  it('applies flex-wrap and a max-height style to the pill container', () => {
    __tagsInUseResult = ['a', 'b', 'c'];
    renderBar();
    const bar = screen.getByTestId('sessions-tag-filter-bar');
    expect(bar.className).toContain('flex-wrap');
    expect(bar.className).toContain('overflow-y-auto');
    expect(bar.style.maxHeight).toBe('72px');
  });
});

// ---------------------------------------------------------------------------
// 12. Collapsible
// ---------------------------------------------------------------------------

describe('TagFilterBar — collapsible', () => {
  it('renders a chevron next to the "Tags" label', () => {
    __tagsInUseResult = ['alpha'];
    renderBar();
    expect(document.querySelector('svg.lucide-chevron-down[aria-hidden="true"]')).toBeTruthy();
  });

  it('clicking the toggle hides the pill grid', () => {
    __tagsInUseResult = ['alpha'];
    renderBar();
    expect(screen.getByTestId('sessions-tag-filter-bar')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sessions-tags-section-toggle'));
    expect(screen.queryByTestId('sessions-tag-filter-bar')).toBeNull();
  });

  it('clicking the toggle again shows the pills again', () => {
    __tagsInUseResult = ['alpha'];
    renderBar();
    fireEvent.click(screen.getByTestId('sessions-tags-section-toggle'));
    fireEvent.click(screen.getByTestId('sessions-tags-section-toggle'));
    expect(screen.getByTestId('sessions-tag-filter-bar')).toBeTruthy();
  });
});
