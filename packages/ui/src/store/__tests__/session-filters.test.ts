import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { useSessionFilters } from '../session-filters';

// Reset the singleton store and localStorage between tests so each test starts
// with a clean slate. Behavior 1 uses vi.resetModules() + dynamic import
// instead, so this beforeEach covers behaviors 2–9 only.
beforeEach(() => {
  useSessionFilters.setState({
    filterProjectId: null,
    selectedTags: new Set(),
    selectedSynthetic: new Set(),
    sortMode: 'recent',
  });
  localStorage.removeItem('mf:filterProjectId');
});

// ---------------------------------------------------------------------------
// session-filters — sortMode defaults to 'recent'
// ---------------------------------------------------------------------------

describe('session-filters — sortMode defaults to recent', () => {
  it('initial sortMode is "recent"', () => {
    expect(useSessionFilters.getState().sortMode).toBe('recent');
  });
});

// ---------------------------------------------------------------------------
// session-filters — setSortMode updates sortMode
// ---------------------------------------------------------------------------

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
// session-filters — Behavior 1: initial filterProjectId reads localStorage
// ---------------------------------------------------------------------------

describe('session-filters — initial filterProjectId reads localStorage on module import', () => {
  it('initialises to the value seeded in localStorage before module load', async () => {
    localStorage.setItem('mf:filterProjectId', 'proj-seed');
    vi.resetModules();

    const { useSessionFilters: freshStore } = await import('../session-filters');

    expect(freshStore.getState().filterProjectId).toBe('proj-seed');

    // Cleanup: remove the seeded key so subsequent tests start clean.
    localStorage.removeItem('mf:filterProjectId');
  });
});

// ---------------------------------------------------------------------------
// session-filters — Behavior 2: setFilterProjectId writes state + localStorage
// ---------------------------------------------------------------------------

describe('session-filters — setFilterProjectId updates state and persists to localStorage', () => {
  it('sets filterProjectId to proj-1 and writes proj-1 to localStorage', () => {
    useSessionFilters.getState().setFilterProjectId('proj-1');

    expect(useSessionFilters.getState().filterProjectId).toBe('proj-1');
    expect(localStorage.getItem('mf:filterProjectId')).toBe('proj-1');
  });
});

// ---------------------------------------------------------------------------
// session-filters — Behavior 3: setFilterProjectId(null) clears state + key
// ---------------------------------------------------------------------------

describe('session-filters — setFilterProjectId(null) clears state and removes localStorage key', () => {
  it('sets filterProjectId to null and removes the localStorage key', () => {
    useSessionFilters.getState().setFilterProjectId('proj-1');
    useSessionFilters.getState().setFilterProjectId(null);

    expect(useSessionFilters.getState().filterProjectId).toBe(null);
    expect(localStorage.getItem('mf:filterProjectId')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// session-filters — Behavior 4: toggleTag adds a tag
// ---------------------------------------------------------------------------

describe('session-filters — toggleTag adds the tag to selectedTags', () => {
  it('selectedTags contains rust with size 1 after one toggleTag call', () => {
    useSessionFilters.getState().toggleTag('rust');

    expect(useSessionFilters.getState().selectedTags.has('rust')).toBe(true);
    expect(useSessionFilters.getState().selectedTags.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// session-filters — Behavior 5: toggleTag removes on second call (toggle off)
// ---------------------------------------------------------------------------

describe('session-filters — toggleTag removes the tag on a second call', () => {
  it('selectedTags does not contain rust and has size 0 after two toggleTag calls', () => {
    useSessionFilters.getState().toggleTag('rust');
    useSessionFilters.getState().toggleTag('rust');

    expect(useSessionFilters.getState().selectedTags.has('rust')).toBe(false);
    expect(useSessionFilters.getState().selectedTags.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// session-filters — Behavior 6: toggleSynthetic adds has-pr
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

// ---------------------------------------------------------------------------
// session-filters — Behavior 7: toggleSynthetic removes on second call
// ---------------------------------------------------------------------------

describe('session-filters — toggleSynthetic removes has-pr on a second call', () => {
  it('selectedSynthetic does not contain has-pr and has size 0 after two toggleSynthetic calls', () => {
    // Guardrail: verify the literal values match the types package at runtime.
    expect(SYNTHETIC_TAGS).toContain('has-pr');
    expect(SYNTHETIC_TAGS).toContain('has-worktree');

    useSessionFilters.getState().toggleSynthetic('has-pr');
    useSessionFilters.getState().toggleSynthetic('has-pr');

    expect(useSessionFilters.getState().selectedSynthetic.has('has-pr')).toBe(false);
    expect(useSessionFilters.getState().selectedSynthetic.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// session-filters — Behavior 8: clearFilters resets all three fields
// ---------------------------------------------------------------------------

describe('session-filters — clearFilters resets filterProjectId, selectedTags, and selectedSynthetic', () => {
  it('all three fields are empty/null and localStorage key is removed after clearFilters', () => {
    useSessionFilters.getState().setFilterProjectId('proj-1');
    useSessionFilters.getState().toggleTag('go');
    useSessionFilters.getState().toggleSynthetic('has-worktree');

    useSessionFilters.getState().clearFilters();

    expect(useSessionFilters.getState().filterProjectId).toBe(null);
    expect(useSessionFilters.getState().selectedTags.size).toBe(0);
    expect(useSessionFilters.getState().selectedSynthetic.size).toBe(0);
    expect(localStorage.getItem('mf:filterProjectId')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// session-filters — Behavior 9: setFilterProjectId cross-project update
// ---------------------------------------------------------------------------

describe('session-filters — setFilterProjectId updates from one project to another', () => {
  it('state and localStorage reflect proj-B after switching from proj-A', () => {
    useSessionFilters.getState().setFilterProjectId('proj-A');
    useSessionFilters.getState().setFilterProjectId('proj-B');

    expect(useSessionFilters.getState().filterProjectId).toBe('proj-B');
    expect(localStorage.getItem('mf:filterProjectId')).toBe('proj-B');
  });
});
