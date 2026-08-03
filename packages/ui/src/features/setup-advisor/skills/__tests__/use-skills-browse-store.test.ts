/**
 * use-skills-browse-store.test.ts
 *
 * The two guards that a rendered test can't see: keystrokes coalesce into one
 * request, and a slow response that has been overtaken never lands. Both
 * matter because the query changes far faster than the registry answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  getSkillsCatalog: vi.fn(),
  searchSkills: vi.fn(),
  SkillsCliError: class SkillsCliError extends Error {},
}));

import { useSkillsBrowseStore, selectBrowseMode, selectBrowseRows } from '../use-skills-browse-store';
import * as skillsCliApi from '@/lib/api/skills-cli';

const result = (skillId: string) => ({
  source: 'acme/skills',
  skillId,
  name: skillId,
  installs: 1,
  isOfficial: null,
});

/** Longer than the store's debounce, short enough to keep the suite quick. */
const PAST_DEBOUNCE = 400;
const settle = () => new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE));

beforeEach(() => {
  act(() => {
    useSkillsBrowseStore.getState().reset();
  });
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => {
    useSkillsBrowseStore.getState().reset();
  });
});

describe('use-skills-browse-store — search', () => {
  it('coalesces a burst of keystrokes into one request for the final query', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([]);

    act(() => {
      const { setQuery } = useSkillsBrowseStore.getState();
      setQuery('y');
      setQuery('ya');
      setQuery('yam');
      setQuery('yaml');
    });
    await act(settle);

    expect(skillsCliApi.searchSkills).toHaveBeenCalledTimes(1);
    expect(skillsCliApi.searchSkills).toHaveBeenCalledWith('yaml');
  });

  it('discards a response the query has already moved past', async () => {
    let resolveFirst: (r: ReturnType<typeof result>[]) => void = () => {};
    vi.mocked(skillsCliApi.searchSkills)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue([result('second')]);

    act(() => useSkillsBrowseStore.getState().setQuery('first'));
    await act(settle);
    act(() => useSkillsBrowseStore.getState().setQuery('second'));
    await act(settle);

    // The overtaken request answers last; its rows must not replace the ones
    // the user is actually looking at.
    await act(async () => {
      resolveFirst([result('first')]);
    });

    expect(selectBrowseRows(useSkillsBrowseStore.getState()).map((r) => r.skillId)).toEqual(['second']);
  });

  it('abandons an in-flight search when the query drops back under the floor', async () => {
    let resolveSearch: (r: ReturnType<typeof result>[]) => void = () => {};
    vi.mocked(skillsCliApi.searchSkills).mockImplementation(() => new Promise((resolve) => (resolveSearch = resolve)));
    act(() => {
      useSkillsBrowseStore.setState({ catalog: [result('from-catalog')], catalogStatus: 'available' });
    });

    act(() => useSkillsBrowseStore.getState().setQuery('yaml'));
    await act(settle);
    act(() => useSkillsBrowseStore.getState().setQuery(''));

    await act(async () => {
      resolveSearch([result('too-late')]);
    });

    const state = useSkillsBrowseStore.getState();
    expect(selectBrowseMode(state)).toBe('catalog');
    expect(selectBrowseRows(state).map((r) => r.skillId)).toEqual(['from-catalog']);
  });
});
