/**
 * useSidebarSkills — unit tests.
 *
 * Moved out of the retired bottom panel with the hook. Agents are dropped from
 * the product surface (plan D15), so the hook no longer fetches them and the
 * agent assertions are gone: `getAgents` is asserted NOT to be called, which is
 * the point of the decision rather than a silent omission.
 *
 * Mocked dependencies: @/lib/api/skills, @/lib/api/agents,
 * @/features/sessions/runtime/daemon-port-context,
 * @/features/sessions/use-active-identity.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getSkills = vi.fn();
const getAgents = vi.fn();
const useActiveIdentity = vi.fn();

vi.mock('@/lib/api/skills', () => ({ getSkills: (...a: unknown[]) => getSkills(...a) }));
vi.mock('@/lib/api/agents', () => ({ getAgents: (...a: unknown[]) => getAgents(...a) }));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => useActiveIdentity() }));

import { useSidebarSkills } from '../use-sidebar-skills';

beforeEach(() => {
  getSkills.mockReset();
  getAgents.mockReset();
  useActiveIdentity.mockReset();
});

describe('useSidebarSkills', () => {
  it('returns empty without fetching when there is no active project path', () => {
    useActiveIdentity.mockReturnValue({ projectName: 'X' });
    const { result } = renderHook(() => useSidebarSkills());
    expect(result.current).toEqual({ skills: [], loading: false });
    expect(getSkills).not.toHaveBeenCalled();
  });

  it('fetches skills for the active project path with the claude adapter', async () => {
    useActiveIdentity.mockReturnValue({ projectName: 'X', projectPath: '/p' });
    getSkills.mockResolvedValue([{ id: 's1', name: 'one' }]);

    const { result } = renderHook(() => useSidebarSkills());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSkills).toHaveBeenCalledWith(31415, 'claude', '/p');
    expect(result.current.skills).toHaveLength(1);
  });

  it('fetches with the active session adapter id, not hardcoded claude', async () => {
    useActiveIdentity.mockReturnValue({ projectName: 'X', projectPath: '/p', adapterId: 'codex' });
    getSkills.mockResolvedValue([]);

    const { result } = renderHook(() => useSidebarSkills());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSkills).toHaveBeenCalledWith(31415, 'codex', '/p');
  });

  it('never fetches agents — they are gone from the product surface (D15)', async () => {
    useActiveIdentity.mockReturnValue({ projectName: 'X', projectPath: '/p' });
    getSkills.mockResolvedValue([]);

    const { result } = renderHook(() => useSidebarSkills());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getAgents).not.toHaveBeenCalled();
  });
});
