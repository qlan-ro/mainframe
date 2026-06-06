/**
 * Behavior tests for SkillsProvider + useChatSkills.
 *
 * What we verify:
 *   - Happy path: resolves the project path from getProjects, fetches skills
 *     with (port, adapterId, path), returns { skills, loading:false }.
 *   - getProjects rejects → { skills:[], loading:false }, no throw (warn logged).
 *   - extras undefined → { skills:[], loading:false }, no fetch at all.
 *
 * Mocking strategy:
 *   1. `@/lib/api/projects`  → vi.fn() stub for getProjects
 *   2. `@/lib/api/skills`    → vi.fn() stub for getSkills
 *   3. `../chat/runtime/use-chat-thread-runtime` → stub useChatExtras
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

vi.mock('../../chat/runtime/use-chat-thread-runtime', () => ({
  useChatExtras: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { SkillsProvider, useChatSkills } from '../use-chat-skills';
import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';
import { useChatExtras } from '../../chat/runtime/use-chat-thread-runtime';
import type { Skill, Project } from '@qlan-ro/mainframe-types';

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
});

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe('useChatSkills — happy path', () => {
  it('eventually returns skills after loading the project path', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);

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

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(vi.mocked(getSkills)).toHaveBeenCalledExactlyOnceWith(PORT, ADAPTER_ID, PROJECT_PATH);
  });
});

// ---------------------------------------------------------------------------
// 2. getProjects rejects → empty skills, no throw
// ---------------------------------------------------------------------------

describe('useChatSkills — getProjects rejects', () => {
  it('returns { skills:[], loading:false } and does not throw', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProjects).mockRejectedValue(new Error('network error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.skills).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[skills]'), expect.any(Error));
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. extras undefined → no fetch, stable empty state
// ---------------------------------------------------------------------------

describe('useChatSkills — extras undefined', () => {
  it('returns { skills:[], loading:false } and never calls getProjects or getSkills', () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);

    const { result } = renderHook(() => useChatSkills(), { wrapper });

    expect(result.current.skills).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(vi.mocked(getProjects)).not.toHaveBeenCalled();
    expect(vi.mocked(getSkills)).not.toHaveBeenCalled();
  });
});
