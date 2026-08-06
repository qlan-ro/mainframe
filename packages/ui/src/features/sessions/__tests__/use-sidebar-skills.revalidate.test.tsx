// @vitest-environment jsdom
/**
 * useSidebarSkills — revalidation-nonce tests.
 *
 * Moved out of the retired bottom panel with the hook. Its second describe
 * rendered `BottomPanel` to prove the same bump moved the Skills tab's count
 * badge; the bottom panel is deleted, and the panel's own Skills sub-group count
 * is covered in `session-panel/__tests__/ContextSection.test.tsx`. What remains
 * here is the hook's own contract: a bump refetches, an unrelated re-render does
 * not.
 *
 * Mocked dependencies: @/lib/api/skills,
 * @/features/sessions/runtime/daemon-port-context,
 * @/features/sessions/use-active-identity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const getSkills = vi.fn();
const useActiveIdentity = vi.fn();

vi.mock('@/lib/api/skills', () => ({ getSkills: (...a: unknown[]) => getSkills(...a) }));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => useActiveIdentity() }));

import { useSidebarSkills } from '../use-sidebar-skills';
import { bumpSkillsRevalidation } from '@/features/skills/use-skills-revalidation';

const PROJECT_PATH = '/p';

beforeEach(() => {
  getSkills.mockReset();
  useActiveIdentity.mockReset();
  useActiveIdentity.mockReturnValue({ projectName: 'X', projectPath: PROJECT_PATH });
});

describe('useSidebarSkills — revalidation nonce', () => {
  it('refetches with the same args after bumpSkillsRevalidation, but not on an unrelated re-render', async () => {
    getSkills.mockResolvedValue([{ id: 's1', name: 'one' }]);

    const { result, rerender } = renderHook(() => useSidebarSkills());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSkills).toHaveBeenCalledTimes(1);
    expect(getSkills).toHaveBeenCalledWith(31415, 'claude', PROJECT_PATH);

    rerender();
    expect(getSkills).toHaveBeenCalledTimes(1);

    act(() => {
      bumpSkillsRevalidation();
    });

    await waitFor(() => expect(getSkills).toHaveBeenCalledTimes(2));
    expect(getSkills).toHaveBeenLastCalledWith(31415, 'claude', PROJECT_PATH);
  });

  it('serves the refetched list, so a shorter post-bump result shrinks the skills array', async () => {
    getSkills.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

    const { result } = renderHook(() => useSidebarSkills());
    await waitFor(() => expect(result.current.skills).toHaveLength(2));

    getSkills.mockResolvedValue([{ id: 's1' }]);
    act(() => {
      bumpSkillsRevalidation();
    });

    await waitFor(() => expect(result.current.skills).toHaveLength(1));
  });
});
