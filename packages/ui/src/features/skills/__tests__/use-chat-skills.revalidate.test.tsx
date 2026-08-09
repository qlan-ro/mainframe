/**
 * use-chat-skills.revalidate.test.tsx (spec AC 11; plan T38 / Group I1)
 *
 * Red until `SkillsProvider` subscribes to the shared skills-revalidation
 * nonce (Group J1). Pins that a skills-cli install/uninstall — surfaced as a
 * `bumpSkillsRevalidation()` call from outside the component tree — makes the
 * composer `/`-trigger provider refetch with the same (port, adapterId, path)
 * it used on mount, and that an unrelated re-render (no nonce bump) does not
 * cause a second fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/api/projects', () => ({
  getProjects: vi.fn(),
}));

vi.mock('@/lib/api/skills', () => ({
  getSkills: vi.fn(),
}));

vi.mock('@/lib/api/agents', () => ({
  getAgents: vi.fn(),
}));

vi.mock('../../chat/runtime/use-chat-thread-runtime', () => ({
  useChatExtras: vi.fn(),
}));

import { SkillsProvider, useChatSkills } from '../use-chat-skills';
import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';
import { getAgents } from '@/lib/api/agents';
import { useChatExtras } from '../../chat/runtime/use-chat-thread-runtime';
import { useDraftConfigStore } from '@/features/sessions/runtime/draft-config';
import { bumpSkillsRevalidation } from '../use-skills-revalidation';
import type { Skill, Project, AgentConfig } from '@qlan-ro/mainframe-types';

const PORT = 1234;
const ADAPTER_ID = 'claude';
const PROJECT_ID = 'p1';
const PROJECT_PATH = '/proj';

const PROJECT_FIXTURE: Project = {
  id: PROJECT_ID,
  name: 'P',
  path: PROJECT_PATH,
  createdAt: '2026-06-06T00:00:00.000Z',
  lastOpenedAt: '2026-06-06T00:00:00.000Z',
};

const SKILL_FIXTURE: Skill = {
  id: 'skill-1',
  adapterId: ADAPTER_ID,
  name: 'my-skill',
  displayName: 'My Skill',
  description: 'Does something useful',
  scope: 'project',
  filePath: '/proj/.claude/skills/my-skill.md',
  content: '# My Skill',
  invocationName: 'my-skill',
};

const AGENT_FIXTURE: AgentConfig = {
  id: 'claude:project:agent:design-conformance',
  adapterId: ADAPTER_ID,
  name: 'design-conformance',
  description: 'Reviews components',
  scope: 'project',
  filePath: '/proj/.claude/agents/design-conformance.md',
  content: '# Design Conformance\n',
};

function makeFakeExtras() {
  return {
    port: PORT,
    state: {
      chatId: 'c1',
      chatConfig: { adapterId: ADAPTER_ID, projectId: PROJECT_ID },
    },
    permissions: {},
    queued: {},
    cancel: vi.fn(),
    replyToPermission: vi.fn(),
    cancelQueued: vi.fn(),
    editQueued: vi.fn(),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <SkillsProvider>{children}</SkillsProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDraftConfigStore.setState({ drafts: new Map() });
  vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
  vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
  vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);
  vi.mocked(getAgents).mockResolvedValue([AGENT_FIXTURE]);
});

describe('useChatSkills — revalidation nonce', () => {
  it('refetches with the same args after bumpSkillsRevalidation, but not on an unrelated re-render', async () => {
    const { result, rerender } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(vi.mocked(getSkills)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getSkills)).toHaveBeenCalledWith(PORT, ADAPTER_ID, PROJECT_PATH);

    rerender();
    expect(vi.mocked(getSkills)).toHaveBeenCalledTimes(1);

    act(() => {
      bumpSkillsRevalidation();
    });

    await waitFor(() => expect(vi.mocked(getSkills)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getSkills)).toHaveBeenLastCalledWith(PORT, ADAPTER_ID, PROJECT_PATH);
  });

  it('renders skills after a bumped nonce refetch that follows a failed skills fetch', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(getSkills).mockRejectedValueOnce(new Error('skills fetch failed')).mockResolvedValue([SKILL_FIXTURE]);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skills).toEqual([]);
    expect(result.current.agents).toEqual([AGENT_FIXTURE]);

    act(() => {
      bumpSkillsRevalidation();
    });

    await waitFor(() => expect(result.current.skills).toEqual([SKILL_FIXTURE]));

    warnSpy.mockRestore();
  });
});
