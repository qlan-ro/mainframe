/**
 * Behavior tests for SkillsProvider + useChatSkills + useChatAgents.
 *
 * What we verify:
 *   - Happy path: resolves the project path from getProjects, fetches skills
 *     AND agents with (port, adapterId, path), returns { skills, agents, loading:false }.
 *   - getProjects rejects → { skills:[], agents:[], loading:false }, no throw (warn logged).
 *   - extras undefined → { skills:[], agents:[], loading:false }, no fetch at all.
 *
 * Mocking strategy:
 *   1. `@/lib/api/projects`  → vi.fn() stub for getProjects
 *   2. `@/lib/api/skills`    → vi.fn() stub for getSkills
 *   3. `@/lib/api/agents`    → vi.fn() stub for getAgents
 *   4. `../chat/runtime/use-chat-thread-runtime` → stub useChatExtras
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { SkillsProvider, useChatSkills, useChatAgents } from '../use-chat-skills';
import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';
import { getAgents } from '@/lib/api/agents';
import { useChatExtras } from '../../chat/runtime/use-chat-thread-runtime';
import { setDraftConfig, useDraftConfigStore } from '@/features/sessions/runtime/draft-config';
import type { Skill, Project, AgentConfig } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** Standard extras with a chat config that has adapterId + projectId. */
function makeFakeExtras() {
  return {
    port: PORT,
    state: {
      chatId: 'c1',
      chatConfig: {
        adapterId: ADAPTER_ID,
        projectId: PROJECT_ID,
      },
    },
    permissions: {},
    queued: {},
    cancel: vi.fn(),
    replyToPermission: vi.fn(),
    cancelQueued: vi.fn(),
    editQueued: vi.fn(),
  };
}

/** Wrapper that mounts SkillsProvider around the hook. */
function wrapper({ children }: { children: ReactNode }) {
  return <SkillsProvider>{children}</SkillsProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDraftConfigStore.setState({ drafts: new Map() });
});

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe('useChatSkills — happy path', () => {
  it('eventually returns skills after loading the project path', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);
    vi.mocked(getAgents).mockResolvedValue([AGENT_FIXTURE]);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.skills).toEqual([SKILL_FIXTURE]);
  });

  it('calls getSkills exactly once with (port, adapterId, resolvedPath)', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);
    vi.mocked(getAgents).mockResolvedValue([AGENT_FIXTURE]);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(vi.mocked(getSkills)).toHaveBeenCalledExactlyOnceWith(PORT, ADAPTER_ID, PROJECT_PATH);
  });
});

// ---------------------------------------------------------------------------
// 1b. Draft thread (no daemon chat yet) — skills load from the in-memory draft's
//     project + adapter, so the pickers populate BEFORE the first send.
// ---------------------------------------------------------------------------

describe('useChatSkills — new-thread draft (no daemon chatConfig)', () => {
  it('loads skills from the draft project + adapter for a __LOCALID_* thread', async () => {
    setDraftConfig('__LOCALID_9', { projectId: PROJECT_ID, adapterId: ADAPTER_ID });
    const draftExtras = {
      ...makeFakeExtras(),
      state: { chatId: '__LOCALID_9', chatConfig: undefined },
    };
    vi.mocked(useChatExtras).mockReturnValue(draftExtras as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);
    vi.mocked(getAgents).mockResolvedValue([AGENT_FIXTURE]);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.skills).toEqual([SKILL_FIXTURE]);
    expect(vi.mocked(getSkills)).toHaveBeenCalledExactlyOnceWith(PORT, ADAPTER_ID, PROJECT_PATH);
  });
});

// ---------------------------------------------------------------------------
// 2. getProjects rejects → empty skills + agents, no throw
// ---------------------------------------------------------------------------

describe('useChatSkills — getProjects rejects', () => {
  it('returns { skills:[], agents:[], loading:false } and does not throw', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockRejectedValue(new Error('network error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.skills).toEqual([]);
    expect(result.current.agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[skills]'), expect.any(Error));
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. extras undefined → no fetch, stable empty state
// ---------------------------------------------------------------------------

describe('useChatSkills — extras undefined', () => {
  it('returns { skills:[], agents:[], loading:false } and never calls getProjects, getSkills, or getAgents', () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    expect(result.current.skills).toEqual([]);
    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(vi.mocked(getProjects)).not.toHaveBeenCalled();
    expect(vi.mocked(getSkills)).not.toHaveBeenCalled();
    expect(vi.mocked(getAgents)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Project id not in returned list → getSkills + getAgents not called
// ---------------------------------------------------------------------------

describe('useChatSkills — projectId not in getProjects result', () => {
  it('returns { skills:[], agents:[], loading:false } and never calls getSkills or getAgents', async () => {
    const otherProject: Project = {
      id: 'other',
      name: 'X',
      path: '/x',
      createdAt: '2026-06-06T00:00:00.000Z',
      lastOpenedAt: '2026-06-06T00:00:00.000Z',
    };
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([otherProject]);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.skills).toEqual([]);
    expect(result.current.agents).toEqual([]);
    expect(vi.mocked(getSkills)).not.toHaveBeenCalled();
    expect(vi.mocked(getAgents)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. getSkills rejects → empty skills + agents, no throw, console.warn called
// ---------------------------------------------------------------------------

describe('useChatSkills — getSkills rejects', () => {
  it('returns { skills:[], agents:[], loading:false } and logs a warning', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockRejectedValue(new Error('skills fetch failed'));
    vi.mocked(getAgents).mockResolvedValue([AGENT_FIXTURE]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.skills).toEqual([]);
    expect(result.current.agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith('[skills] failed to load skills', expect.any(Error));
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 6. Stale-clear on dependency change — old skills + agents are not retained
// ---------------------------------------------------------------------------

describe('useChatSkills — stale-clear on projectId change', () => {
  it('does not retain p1 skills after switching to p2', async () => {
    // ---- p1 fixtures ----
    const PROJECT_P2_PATH = '/proj-two';
    const PROJECT_P2: Project = {
      id: 'p2',
      name: 'P2',
      path: PROJECT_P2_PATH,
      createdAt: '2026-06-06T00:00:00.000Z',
      lastOpenedAt: '2026-06-06T00:00:00.000Z',
    };
    const SKILL_P2: Skill = {
      id: 'skill-p2',
      adapterId: ADAPTER_ID,
      name: 'p2-skill',
      displayName: 'P2 Skill',
      description: 'Belongs to project 2',
      scope: 'project',
      filePath: '/proj-two/.claude/skills/p2-skill.md',
      content: '# P2 Skill',
      invocationName: 'p2-skill',
    };

    // p1: resolves immediately
    const extrasP1 = makeFakeExtras();
    vi.mocked(useChatExtras).mockReturnValue(extrasP1 as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);
    vi.mocked(getAgents).mockResolvedValue([AGENT_FIXTURE]);

    const { result, rerender } = renderHook(() => useChatSkills(), { wrapper });

    // Wait for p1 skills to settle
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.skills).toEqual([SKILL_FIXTURE]);

    // ---- switch to p2 ----
    let resolveP2Skills!: (v: Skill[]) => void;
    const p2SkillsPromise = new Promise<Skill[]>((res) => {
      resolveP2Skills = res;
    });

    const extrasP2 = {
      ...makeFakeExtras(),
      state: {
        chatId: 'c1',
        chatConfig: { adapterId: ADAPTER_ID, projectId: 'p2' },
      },
    };
    vi.mocked(useChatExtras).mockReturnValue(extrasP2 as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_P2]);
    vi.mocked(getSkills).mockReturnValue(p2SkillsPromise);
    vi.mocked(getAgents).mockResolvedValue([]);

    rerender();

    // The provider calls setSkills([]) and setAgents([]) synchronously before
    // the async refetch; both must be cleared while p2 is in-flight.
    await waitFor(() => {
      expect(result.current.skills).toEqual([]);
    });

    // Now let p2 resolve and confirm the final state shows p2 skills only
    resolveP2Skills([SKILL_P2]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.skills).toEqual([SKILL_P2]);
  });
});

// ---------------------------------------------------------------------------
// 7. Agents are fetched and exposed via useChatAgents
// ---------------------------------------------------------------------------

describe('useChatAgents', () => {
  it('fetches agents in the same effect as skills and exposes them via useChatAgents', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);
    vi.mocked(getAgents).mockResolvedValue([AGENT_FIXTURE]);

    const { result } = renderHook(() => useChatAgents(), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual([AGENT_FIXTURE]);
    });

    expect(vi.mocked(getAgents)).toHaveBeenCalledExactlyOnceWith(PORT, ADAPTER_ID, PROJECT_PATH);
  });

  it('calls getAgents with (port, adapterId, resolvedPath) — same args as getSkills', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([]);
    vi.mocked(getAgents).mockResolvedValue([AGENT_FIXTURE]);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(vi.mocked(getAgents)).toHaveBeenCalledExactlyOnceWith(PORT, ADAPTER_ID, PROJECT_PATH);
    expect(result.current.agents).toEqual([AGENT_FIXTURE]);
  });

  it('returns [] when extras is undefined', () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);

    const { result } = renderHook(() => useChatAgents(), { wrapper });

    expect(result.current).toEqual([]);
  });

  it('returns [] when getAgents rejects (covered by shared catch)', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);
    vi.mocked(getAgents).mockRejectedValue(new Error('agents fetch failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() => useChatAgents(), { wrapper });

    await waitFor(() => {
      // loading settles to false in the finally block
      expect(vi.mocked(getProjects)).toHaveBeenCalled();
    });

    // The Promise.all rejects → catch resets both
    await waitFor(() => {
      expect(result.current).toEqual([]);
    });

    warnSpy.mockRestore();
  });
});
