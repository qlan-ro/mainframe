/**
 * Behavior contract for useSkillsSection (plan T24): the Skills section's
 * fetch/status state machine, its identity-scoped `identityKey`, and its
 * `remove()` delete action.
 *
 * Mocking strategy: `@/lib/api/skills` and `@/features/sessions/use-active-identity`
 * are stubbed; `@/features/sessions/runtime/daemon-port-context` returns a fixed
 * port. `use-skills-revalidation` is the REAL store (not mocked) — this proves
 * the hook subscribes to, and writes, the actual shared signal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { Skill } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/skills', () => ({
  getSkills: vi.fn(),
  deleteSkill: vi.fn(),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(),
}));

import { useSkillsSection } from '../use-skills-section';
import { getSkills, deleteSkill } from '@/lib/api/skills';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { ApiRequestError } from '@/lib/api/http';
// Real store — proves the hook bumps and re-reads the actual shared signal.
import { bumpSkillsRevalidation, useSkillsRevalidation } from '@/features/skills/use-skills-revalidation';

const getSkillsMock = vi.mocked(getSkills);
const deleteSkillMock = vi.mocked(deleteSkill);
const useActiveIdentityMock = vi.mocked(useActiveIdentity);

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'claude:project:review',
    adapterId: 'claude',
    name: 'review',
    displayName: 'Review',
    description: 'Reviews code',
    scope: 'project',
    filePath: '/p/.claude/skills/review/SKILL.md',
    content: '# Review',
    invocationName: 'review',
    ...overrides,
  };
}

function identity(overrides: { projectPath?: string; adapterId?: string } = {}) {
  return { projectName: 'X', ...overrides } as ReturnType<typeof useActiveIdentity>;
}

beforeEach(() => {
  getSkillsMock.mockReset();
  deleteSkillMock.mockReset();
  useActiveIdentityMock.mockReset();
  useSkillsRevalidation.setState({ nonce: 0 });
});

describe('useSkillsSection — no active project', () => {
  it('does not fetch and reports status "empty" when there is no projectPath', () => {
    useActiveIdentityMock.mockReturnValue(identity());

    const { result } = renderHook(() => useSkillsSection());

    expect(getSkillsMock).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: 'empty' });
  });
});

describe('useSkillsSection — adapter resolution', () => {
  it('falls back to the claude adapter when adapterId is missing', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockResolvedValue([]);

    renderHook(() => useSkillsSection());

    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledWith(31415, 'claude', '/p'));
  });

  it('uses the active session adapterId verbatim when present', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p', adapterId: 'codex' }));
    getSkillsMock.mockResolvedValue([]);

    renderHook(() => useSkillsSection());

    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledWith(31415, 'codex', '/p'));
  });
});

describe('useSkillsSection — fetch status machine', () => {
  it('is "loading" while the fetch is in flight', () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useSkillsSection());

    expect(result.current.state).toEqual({ status: 'loading' });
  });

  it('is "empty" on a resolved empty array', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockResolvedValue([]);

    const { result } = renderHook(() => useSkillsSection());

    await waitFor(() => expect(result.current.state).toEqual({ status: 'empty' }));
  });

  it('is "ready" carrying the skills on a resolved non-empty array', async () => {
    const s = skill();
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockResolvedValue([s]);

    const { result } = renderHook(() => useSkillsSection());

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', skills: [s] }));
  });

  it('is "unsupported" when the rejection is an ApiRequestError with status 404', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockRejectedValue(new ApiRequestError('Adapter not found or does not support skills', [], 404));

    const { result } = renderHook(() => useSkillsSection());

    await waitFor(() => expect(result.current.state).toEqual({ status: 'unsupported' }));
  });

  it('is "error" with the message when the rejection is an ApiRequestError with a non-404 status', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockRejectedValue(new ApiRequestError('Operation failed', [], 500));

    const { result } = renderHook(() => useSkillsSection());

    await waitFor(() => expect(result.current.state).toEqual({ status: 'error', message: 'Operation failed' }));
  });

  it('is "error" with the message when the rejection is not an ApiRequestError', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockRejectedValue(new Error('network fail'));

    const { result } = renderHook(() => useSkillsSection());

    await waitFor(() => expect(result.current.state).toEqual({ status: 'error', message: 'network fail' }));
  });
});

describe('useSkillsSection — revalidation and reload', () => {
  it('refetches when the shared skills-revalidation nonce is bumped', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockResolvedValue([]);

    renderHook(() => useSkillsSection());
    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledTimes(1));

    act(() => {
      bumpSkillsRevalidation();
    });

    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledTimes(2));
  });

  it('refetches when reload() is called', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p' }));
    getSkillsMock.mockResolvedValue([]);

    const { result } = renderHook(() => useSkillsSection());
    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledTimes(2));
  });
});

describe('useSkillsSection — project switch', () => {
  it('clears a previously ready list before the new project response lands (no stale flash)', async () => {
    const a = skill({ id: 'a', name: 'a' });
    const b = skill({ id: 'b', name: 'b' });
    getSkillsMock.mockResolvedValueOnce([a]);
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/a' }));

    const { result, rerender } = renderHook(() => useSkillsSection());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', skills: [a] }));

    let resolveB!: (v: Skill[]) => void;
    getSkillsMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveB = res;
        }),
    );
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/b' }));
    act(() => {
      rerender();
    });

    expect(result.current.state.status).not.toBe('ready');

    resolveB([b]);
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', skills: [b] }));
  });

  it('ignores a late response from a superseded fetch', async () => {
    let resolveA!: (v: Skill[]) => void;
    getSkillsMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveA = res;
        }),
    );
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/a' }));

    const { result, rerender } = renderHook(() => useSkillsSection());
    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledTimes(1));

    const b = skill({ id: 'b', name: 'b' });
    getSkillsMock.mockResolvedValueOnce([b]);
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/b' }));
    act(() => {
      rerender();
    });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', skills: [b] }));

    const a = skill({ id: 'a', name: 'a' });
    await act(async () => {
      resolveA([a]);
    });

    expect(result.current.state).toEqual({ status: 'ready', skills: [b] });
  });
});

describe('useSkillsSection — identityKey', () => {
  it('stays stable across a nonce-triggered refetch of the same identity', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p', adapterId: 'claude' }));
    getSkillsMock.mockResolvedValue([]);

    const { result } = renderHook(() => useSkillsSection());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'empty' }));
    const before = result.current.identityKey;

    act(() => {
      bumpSkillsRevalidation();
    });
    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledTimes(2));

    expect(result.current.identityKey).toBe(before);
  });

  it('changes when adapterId changes', () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p', adapterId: 'claude' }));
    getSkillsMock.mockResolvedValue([]);

    const { result, rerender } = renderHook(() => useSkillsSection());
    const before = result.current.identityKey;

    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p', adapterId: 'codex' }));
    rerender();

    expect(result.current.identityKey).not.toBe(before);
  });

  it('changes when projectPath changes', () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/a', adapterId: 'claude' }));
    getSkillsMock.mockResolvedValue([]);

    const { result, rerender } = renderHook(() => useSkillsSection());
    const before = result.current.identityKey;

    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/b', adapterId: 'claude' }));
    rerender();

    expect(result.current.identityKey).not.toBe(before);
  });
});

describe('useSkillsSection — remove()', () => {
  it('calls deleteSkill with the resolved port/adapter/project and bumps the nonce on success', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p', adapterId: 'claude' }));
    getSkillsMock.mockResolvedValue([]);
    deleteSkillMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSkillsSection());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'empty' }));

    const before = useSkillsRevalidation.getState().nonce;
    await act(async () => {
      await result.current.remove('claude:project:review');
    });

    expect(deleteSkillMock).toHaveBeenCalledWith(31415, 'claude', 'claude:project:review', '/p');
    expect(useSkillsRevalidation.getState().nonce).toBeGreaterThan(before);
  });

  it('rejects with the daemon message and still bumps the nonce on failure (refetch, not optimistic removal)', async () => {
    useActiveIdentityMock.mockReturnValue(identity({ projectPath: '/p', adapterId: 'claude' }));
    getSkillsMock.mockResolvedValue([]);
    deleteSkillMock.mockRejectedValue(new Error('Operation failed'));

    const { result } = renderHook(() => useSkillsSection());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'empty' }));

    const before = useSkillsRevalidation.getState().nonce;
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.remove('claude:project:review');
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Operation failed');
    expect(useSkillsRevalidation.getState().nonce).toBeGreaterThan(before);
  });
});
