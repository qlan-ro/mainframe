import { describe, it, expect, beforeEach } from 'vitest';
import { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';
import { useSessionFilters, soleProjectId } from '../session-filters';

// The active daemon defaults to 'local', so the scoped key is 'mf:filterProjectIds::local'.
const SCOPED_KEY = 'mf:filterProjectIds::local';
const OLD_SCOPED_KEY = 'mf:filterProjectId::local';

// Reset the singleton store and localStorage between tests so each test starts
// with a clean slate. The initial-read-from-localStorage and old-key-migration
// behaviors live in session-filters-migration.test.ts (they need vi.resetModules()).
beforeEach(() => {
  setActiveDaemon({ id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:0', token: null });
  useSessionFilters.setState({
    filterProjectIds: new Set(),
    selectedTags: new Set(),
    selectedSynthetic: new Set(),
    sortMode: 'recent',
  });
  localStorage.removeItem(SCOPED_KEY);
  localStorage.removeItem(OLD_SCOPED_KEY);
});

// ---------------------------------------------------------------------------
// session-filters — sortMode defaults to 'recent'
// ---------------------------------------------------------------------------

describe('session-filters — sortMode defaults to recent', () => {
  it('initial sortMode is "recent"', () => {
    expect(useSessionFilters.getState().sortMode).toBe('recent');
  });
});

describe('session-filters — setSortMode updates the sort mode', () => {
  it('sets sortMode to "name"', () => {
    useSessionFilters.getState().setSortMode('name');
    expect(useSessionFilters.getState().sortMode).toBe('name');
  });

  it('sets sortMode to "status"', () => {
    useSessionFilters.getState().setSortMode('status');
    expect(useSessionFilters.getState().sortMode).toBe('status');
  });
});

// ---------------------------------------------------------------------------
// session-filters — filterProjectIds defaults to an empty set
// ---------------------------------------------------------------------------

describe('session-filters — filterProjectIds defaults to an empty set', () => {
  it('starts empty (meaning "all projects")', () => {
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// session-filters — toggleFilterProject
// ---------------------------------------------------------------------------

describe('session-filters — toggleFilterProject adds an absent id', () => {
  it('adds proj-1 to an empty set', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['proj-1']));
  });

  it('adds a second id alongside the first, keeping both', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    useSessionFilters.getState().toggleFilterProject('proj-2');
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['proj-1', 'proj-2']));
  });
});

describe('session-filters — toggleFilterProject removes a present id (round trip)', () => {
  it('removes proj-1 on the second toggle, leaving an empty set', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    useSessionFilters.getState().toggleFilterProject('proj-1');
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set());
  });

  it('removing one id of two leaves the other in place', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    useSessionFilters.getState().toggleFilterProject('proj-2');
    useSessionFilters.getState().toggleFilterProject('proj-1');
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['proj-2']));
  });
});

// ---------------------------------------------------------------------------
// session-filters — clearProjectFilter
// ---------------------------------------------------------------------------

describe('session-filters — clearProjectFilter empties the set', () => {
  it('empties a two-id set and removes the scoped localStorage key', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    useSessionFilters.getState().toggleFilterProject('proj-2');

    useSessionFilters.getState().clearProjectFilter();

    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set());
    expect(localStorage.getItem(SCOPED_KEY)).toBeNull();
  });

  it('is a no-op on an already-empty set', () => {
    useSessionFilters.getState().clearProjectFilter();
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// session-filters — removeFilterProject
// ---------------------------------------------------------------------------

describe('session-filters — removeFilterProject', () => {
  it('removes a present id, keeping the other scoped project', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    useSessionFilters.getState().toggleFilterProject('proj-2');

    useSessionFilters.getState().removeFilterProject('proj-1');

    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['proj-2']));
  });

  it('is a no-op when the id is absent from the set', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');

    useSessionFilters.getState().removeFilterProject('proj-missing');

    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['proj-1']));
  });

  it('is a no-op on an already-empty set', () => {
    useSessionFilters.getState().removeFilterProject('proj-1');
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// session-filters — filterProjectIds persistence
// ---------------------------------------------------------------------------

describe('session-filters — filterProjectIds persists to localStorage', () => {
  it('writes a single id as a one-element JSON array', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    expect(localStorage.getItem(SCOPED_KEY)).toBe('["proj-1"]');
  });

  it('writes two ids as a two-element JSON array, in insertion order', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    useSessionFilters.getState().toggleFilterProject('proj-2');
    expect(localStorage.getItem(SCOPED_KEY)).toBe('["proj-1","proj-2"]');
  });

  it('removes the localStorage key once the set becomes empty again, rather than writing "[]"', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    useSessionFilters.getState().toggleFilterProject('proj-1');
    expect(localStorage.getItem(SCOPED_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// session-filters — toggleTag
// ---------------------------------------------------------------------------

describe('session-filters — toggleTag adds the tag to selectedTags', () => {
  it('selectedTags contains rust with size 1 after one toggleTag call', () => {
    useSessionFilters.getState().toggleTag('rust');

    expect(useSessionFilters.getState().selectedTags.has('rust')).toBe(true);
    expect(useSessionFilters.getState().selectedTags.size).toBe(1);
  });
});

describe('session-filters — toggleTag removes the tag on a second call', () => {
  it('selectedTags does not contain rust and has size 0 after two toggleTag calls', () => {
    useSessionFilters.getState().toggleTag('rust');
    useSessionFilters.getState().toggleTag('rust');

    expect(useSessionFilters.getState().selectedTags.has('rust')).toBe(false);
    expect(useSessionFilters.getState().selectedTags.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// session-filters — toggleSynthetic
// ---------------------------------------------------------------------------

describe('session-filters — toggleSynthetic adds has-pr to selectedSynthetic', () => {
  it('selectedSynthetic contains has-pr (size 1) and does not contain has-worktree', () => {
    // Guardrail: verify the literal values match the types package at runtime.
    expect(SYNTHETIC_TAGS).toContain('has-pr');
    expect(SYNTHETIC_TAGS).toContain('has-worktree');

    useSessionFilters.getState().toggleSynthetic('has-pr');

    expect(useSessionFilters.getState().selectedSynthetic.has('has-pr')).toBe(true);
    expect(useSessionFilters.getState().selectedSynthetic.has('has-worktree')).toBe(false);
    expect(useSessionFilters.getState().selectedSynthetic.size).toBe(1);
  });
});

describe('session-filters — toggleSynthetic removes has-pr on a second call', () => {
  it('selectedSynthetic does not contain has-pr and has size 0 after two toggleSynthetic calls', () => {
    useSessionFilters.getState().toggleSynthetic('has-pr');
    useSessionFilters.getState().toggleSynthetic('has-pr');

    expect(useSessionFilters.getState().selectedSynthetic.has('has-pr')).toBe(false);
    expect(useSessionFilters.getState().selectedSynthetic.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// session-filters — clearFilters resets filterProjectIds, tags, and synthetic
// ---------------------------------------------------------------------------

describe('session-filters — clearFilters resets filterProjectIds, selectedTags, and selectedSynthetic', () => {
  it('all three fields are empty and the scoped localStorage key is removed after clearFilters', () => {
    useSessionFilters.getState().toggleFilterProject('proj-1');
    useSessionFilters.getState().toggleFilterProject('proj-2');
    useSessionFilters.getState().toggleTag('go');
    useSessionFilters.getState().toggleSynthetic('has-worktree');

    useSessionFilters.getState().clearFilters();

    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set());
    expect(useSessionFilters.getState().selectedTags.size).toBe(0);
    expect(useSessionFilters.getState().selectedSynthetic.size).toBe(0);
    expect(localStorage.getItem(SCOPED_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// soleProjectId — pure helper
// ---------------------------------------------------------------------------

describe('soleProjectId', () => {
  it('returns null for an empty set', () => {
    expect(soleProjectId(new Set())).toBeNull();
  });

  it('returns the id for a single-element set', () => {
    expect(soleProjectId(new Set(['proj-1']))).toBe('proj-1');
  });

  it('returns null for a two-element set', () => {
    expect(soleProjectId(new Set(['proj-1', 'proj-2']))).toBeNull();
  });
});
