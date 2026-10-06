/**
 * SessionsFilterMenu — unit tests.
 *
 * D15: the tag filter lives on the first group header as one `primary` chip
 * (the lone filter's name, or "N filters" for several) plus the filter
 * button. Picks AND together and the menu stays open across them
 * (multi-select); Clear filters (and the chip itself) drops every pick.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { useSessionFilters } from '@/store/session-filters';
import { SessionsFilterMenu, filterChipLabel } from '../SessionsFilterMenu';

describe('filterChipLabel', () => {
  it('is null with nothing selected', () => {
    expect(filterChipLabel([])).toBeNull();
  });

  it('is the lone tag name when exactly one is selected', () => {
    expect(filterChipLabel(['bug'])).toBe('bug');
  });

  it('is "N filters" once two or more are selected', () => {
    expect(filterChipLabel(['bug', 'has-pr'])).toBe('2 filters');
    expect(filterChipLabel(['a', 'b', 'c'])).toBe('3 filters');
  });
});

function registry(): TagRegistry {
  return {
    tags: [],
    loading: false,
    refresh: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    colorOf: () => 'blue',
  };
}

function renderMenu(inUse: string[] = ['bug', 'urgent'], synthetic: readonly 'has-pr'[] = ['has-pr']) {
  render(<SessionsFilterMenu inUse={inUse} synthetic={[...synthetic]} registry={registry()} />);
}

function openMenu() {
  const trigger = screen.getByTestId('sessions-filter-button');
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger);
  fireEvent.click(trigger);
}

beforeEach(() => {
  useSessionFilters.setState({ selectedTags: new Set(), selectedSynthetic: new Set() });
});

describe('SessionsFilterMenu — the chip', () => {
  it('renders no chip with nothing selected', () => {
    renderMenu();
    expect(screen.queryByTestId('sessions-filter-chip')).toBeNull();
  });

  it('shows the tag name when exactly one filter is active', () => {
    useSessionFilters.setState({ selectedTags: new Set(['bug']) });
    renderMenu();
    expect(screen.getByTestId('sessions-filter-chip')).toHaveTextContent('bug');
  });

  it('shows "N filters" once several are active, across tags and synthetic', () => {
    useSessionFilters.setState({ selectedTags: new Set(['bug']), selectedSynthetic: new Set(['has-pr']) });
    renderMenu();
    expect(screen.getByTestId('sessions-filter-chip')).toHaveTextContent('2 filters');
  });

  it('clears every filter when the chip itself is clicked', () => {
    useSessionFilters.setState({ selectedTags: new Set(['bug', 'urgent']), selectedSynthetic: new Set(['has-pr']) });
    renderMenu();
    fireEvent.click(screen.getByTestId('sessions-filter-chip'));
    expect(useSessionFilters.getState().selectedTags.size).toBe(0);
    expect(useSessionFilters.getState().selectedSynthetic.size).toBe(0);
  });
});

describe('SessionsFilterMenu — the menu', () => {
  it('lists only the in-use tags and the offered synthetic kinds', () => {
    renderMenu(['bug', 'urgent'], ['has-pr']);
    openMenu();
    expect(screen.getByTestId('sessions-tag-filter-bug')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-tag-filter-urgent')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-tag-filter-synthetic-has-pr')).toBeInTheDocument();
  });

  it('toggles a tag on check, AND-ing with whatever else is already selected', () => {
    useSessionFilters.setState({ selectedTags: new Set(['urgent']) });
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-bug'));
    expect(useSessionFilters.getState().selectedTags).toEqual(new Set(['urgent', 'bug']));
  });

  it('toggles a tag back off on a second check', () => {
    useSessionFilters.setState({ selectedTags: new Set(['bug']) });
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-bug'));
    expect(useSessionFilters.getState().selectedTags.has('bug')).toBe(false);
  });

  it('toggles a synthetic kind the same way', () => {
    renderMenu(['bug'], ['has-pr']);
    openMenu();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-synthetic-has-pr'));
    expect(useSessionFilters.getState().selectedSynthetic.has('has-pr')).toBe(true);
  });

  it('shows no "Clear filters" row with nothing selected', () => {
    renderMenu();
    openMenu();
    expect(screen.queryByTestId('sessions-tag-filter-clear')).toBeNull();
  });

  it('clears every filter from "Clear filters"', () => {
    useSessionFilters.setState({ selectedTags: new Set(['bug']), selectedSynthetic: new Set(['has-pr']) });
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-clear'));
    expect(useSessionFilters.getState().selectedTags.size).toBe(0);
    expect(useSessionFilters.getState().selectedSynthetic.size).toBe(0);
  });
});
