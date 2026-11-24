/**
 * SessionsFilterMenu — unit tests.
 *
 * The list's filter lives on the first group header: one status ("Show") plus
 * tags that AND together, in a menu that stays open across picks. An active
 * filter keeps the button visible and named; Clear filters drops every pick.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { useSessionFilters } from '@/store/session-filters';
import { SessionsFilterMenu, filterButtonLabel } from '../SessionsFilterMenu';

describe('filterButtonLabel', () => {
  it('names only the action with nothing filtered', () => {
    expect(filterButtonLabel('all', [])).toBe('Filter sessions');
  });

  it('says what is filtered, status first', () => {
    expect(filterButtonLabel('needs-you', [])).toBe('Filter sessions: Needs you');
    expect(filterButtonLabel('running', ['bug', 'has-pr'])).toBe('Filter sessions: Running, bug, has-pr');
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
  useSessionFilters.setState({ statusFilter: 'all', selectedTags: new Set(), selectedSynthetic: new Set() });
});

describe('SessionsFilterMenu — the button', () => {
  const button = () => screen.getByTestId('sessions-filter-button');

  it('waits for hover with nothing filtered', () => {
    renderMenu();
    expect(button()).not.toHaveAttribute('data-filtered');
    expect(button()).toHaveClass('opacity-0');
  });

  it.each([
    ['a status', { statusFilter: 'running' as const }, 'Filter sessions: Running'],
    ['a tag', { selectedTags: new Set(['bug']) }, 'Filter sessions: bug'],
    ['a synthetic kind', { selectedSynthetic: new Set(['has-pr' as const]) }, 'Filter sessions: has-pr'],
  ])('stays on screen and says so while %s filters the list', (_what, state, label) => {
    useSessionFilters.setState(state);
    renderMenu();
    expect(button()).toHaveAttribute('data-filtered', 'true');
    expect(button()).not.toHaveClass('opacity-0');
    expect(button()).toHaveAccessibleName(label);
  });
});

describe('SessionsFilterMenu — the menu', () => {
  it('shows one status at a time and keeps the menu open for tag picks', () => {
    renderMenu();
    openMenu();
    expect(screen.getByTestId('sessions-status-filter-all')).toHaveAttribute('data-state', 'checked');
    fireEvent.click(screen.getByTestId('sessions-status-filter-needs-you'));
    expect(useSessionFilters.getState().statusFilter).toBe('needs-you');
    expect(screen.getByTestId('sessions-status-filter-all')).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByTestId('sessions-tag-filter-bug')).toBeInTheDocument();
  });

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
    useSessionFilters.setState({
      statusFilter: 'running',
      selectedTags: new Set(['bug']),
      selectedSynthetic: new Set(['has-pr']),
    });
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId('sessions-tag-filter-clear'));
    expect(useSessionFilters.getState().statusFilter).toBe('all');
    expect(useSessionFilters.getState().selectedTags.size).toBe(0);
    expect(useSessionFilters.getState().selectedSynthetic.size).toBe(0);
  });
});
