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
    expect(result.current).toEqual({ skills: [], agents: [], loading: false });
    expect(getSkills).not.toHaveBeenCalled();
  });

  it('fetches skills + agents for the active project path with the claude adapter', async () => {
    useActiveIdentity.mockReturnValue({ projectName: 'X', projectPath: '/p' });
    getSkills.mockResolvedValue([{ id: 's1', name: 'one' }]);
    getAgents.mockResolvedValue([{ id: 'a1', name: 'bot' }]);

    const { result } = renderHook(() => useSidebarSkills());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSkills).toHaveBeenCalledWith(31415, 'claude', '/p');
    expect(getAgents).toHaveBeenCalledWith(31415, 'claude', '/p');
    expect(result.current.skills).toHaveLength(1);
    expect(result.current.agents).toHaveLength(1);
  });

  it('fetches with the active session adapter id, not hardcoded claude', async () => {
    useActiveIdentity.mockReturnValue({ projectName: 'X', projectPath: '/p', adapterId: 'codex' });
    getSkills.mockResolvedValue([]);
    getAgents.mockResolvedValue([]);

    const { result } = renderHook(() => useSidebarSkills());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSkills).toHaveBeenCalledWith(31415, 'codex', '/p');
    expect(getAgents).toHaveBeenCalledWith(31415, 'codex', '/p');
  });
});
