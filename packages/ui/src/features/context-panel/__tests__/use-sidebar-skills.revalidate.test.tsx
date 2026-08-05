// @vitest-environment jsdom
/**
 * use-sidebar-skills.revalidate.test.tsx (spec AC 11; plan T39 / Group I2)
 *
 * Red until `useSidebarSkills` subscribes to the shared skills-revalidation
 * nonce (Group J1). Mirrors use-chat-skills.revalidate.test.tsx over the
 * sidebar hook, then renders `BottomPanel` to prove the same bump changes
 * the Skills tab's count badge — the badge is `skills.length` from this hook
 * (BottomPanel.tsx), so a shorter post-bump list must show a smaller count.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';

const getSkills = vi.fn();
const getAgents = vi.fn();
const useActiveIdentity = vi.fn();

vi.mock('@/lib/api/skills', () => ({ getSkills: (...a: unknown[]) => getSkills(...a) }));
vi.mock('@/lib/api/agents', () => ({ getAgents: (...a: unknown[]) => getAgents(...a) }));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => useActiveIdentity() }));

import { useSidebarSkills } from '../use-sidebar-skills';
import { bumpSkillsRevalidation } from '@/features/skills/use-skills-revalidation';

const PROJECT_PATH = '/p';

beforeEach(() => {
  getSkills.mockReset();
  getAgents.mockReset();
  useActiveIdentity.mockReset();
  useActiveIdentity.mockReturnValue({ projectName: 'X', projectPath: PROJECT_PATH });
});

describe('useSidebarSkills — revalidation nonce', () => {
  it('refetches with the same args after bumpSkillsRevalidation, but not on an unrelated re-render', async () => {
    getSkills.mockResolvedValue([{ id: 's1', name: 'one' }]);
    getAgents.mockResolvedValue([]);

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
});

describe('BottomPanel — Skills tab badge reflects a post-bump refetch', () => {
  it('drops the skills-tab count when the bump-triggered refetch returns fewer skills', async () => {
    vi.doMock('../use-session-context', () => ({
      useSessionContext: () => ({ chatId: 'c1', context: null }),
    }));
    vi.doMock('../ContextInspector', () => ({ ContextInspector: () => <div data-testid="ctx-body" /> }));
    vi.doMock('../SkillsList', () => ({ SkillsList: () => <div data-testid="skills-body" /> }));
    vi.doMock('../AgentsList', () => ({ AgentsList: () => <div data-testid="agents-body" /> }));
    const { BottomPanel } = await import('../BottomPanel');

    getSkills.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    getAgents.mockResolvedValue([]);

    render(<BottomPanel />);

    await waitFor(() => expect(screen.getByTestId('sidebar-bottom-tab-skills')).toHaveTextContent('2'));

    getSkills.mockResolvedValue([{ id: 's1' }]);

    act(() => {
      bumpSkillsRevalidation();
    });

    await waitFor(() => expect(screen.getByTestId('sidebar-bottom-tab-skills')).toHaveTextContent('1'));
  });
});
