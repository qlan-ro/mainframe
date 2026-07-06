import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Suggestion } from '@qlan-ro/mainframe-types';

const getSuggestions = vi.fn();
vi.mock('@/lib/api/suggestions', () => ({ getSuggestions: (...a: unknown[]) => getSuggestions(...a) }));
vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

import { useRepoSuggestions } from '../use-repo-suggestions';

const S: Suggestion = { icon: 'git-compare', tint: 'accent', title: 'x', meta: 'm', prefill: 'p' };

describe('useRepoSuggestions', () => {
  // vi.clearAllMocks() rather than getSuggestions.mockReset(): mockReset() called
  // from inside a beforeEach hook (as opposed to inline in the test body) was
  // observed to desync React 19's effect-scheduling microtask timing from
  // Vitest's unhandled-rejection window, causing "swallows a fetch error" to
  // spuriously fail even though the .catch() handler runs (verified via a
  // console.warn probe). clearAllMocks matches the working pattern already used
  // by use-projects.test.tsx and avoids the same trap.
  beforeEach(() => vi.clearAllMocks());

  it('returns [] before resolving and the fetched list after', async () => {
    getSuggestions.mockResolvedValue([S, S]);
    const { result } = renderHook(() => useRepoSuggestions('proj-1'));
    expect(result.current.suggestions).toEqual([]);
    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));
  });

  it('stays empty when projectId is null (no fetch)', () => {
    const { result } = renderHook(() => useRepoSuggestions(null));
    expect(result.current.suggestions).toEqual([]);
    expect(getSuggestions).not.toHaveBeenCalled();
  });

  it('swallows a fetch error and stays empty', async () => {
    getSuggestions.mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useRepoSuggestions('proj-1'));
    await waitFor(() => expect(getSuggestions).toHaveBeenCalled());
    expect(result.current.suggestions).toEqual([]);
    warn.mockRestore();
  });
});
