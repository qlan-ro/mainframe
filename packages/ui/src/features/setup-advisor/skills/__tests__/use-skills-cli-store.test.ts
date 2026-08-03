// @vitest-environment jsdom
/**
 * use-skills-cli-store.test.ts
 *
 * Red until `../use-skills-cli-store` exists (plan Group F1). Pins the
 * Skills-section data store (plan E1) against a mocked `@/lib/api/skills-cli`:
 *  1. loadManifest — loading -> entries -> loading cleared (available case).
 *  2. An unavailable manifest sets status 'unavailable', not 'error'.
 *  3. install success bumps the skills-revalidation nonce, then re-reads the
 *     manifest — in that order.
 *  4. install failure records {message, tail} and still re-reads the
 *     manifest; the store's entries reflect the re-read, never a locally
 *     mutated list (spec AC 12), and the nonce is not bumped.
 *  5. uninstall mirrors 3 and 4.
 *  6. A stale in-flight manifest response for a previous project is discarded
 *     (the `_loadSeq` idiom already used by use-setup-advisor-store.ts).
 *  7. reset() clears manifest, probe and failure state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';

// `vi.hoisted` because `vi.mock`'s factory is hoisted above the module body and
// runs during the first import of the mocked module — a plain class declaration
// here would still be in its temporal dead zone by then.
const { SkillsCliError } = vi.hoisted(() => ({
  SkillsCliError: class SkillsCliError extends Error {
    readonly tail?: string;
    readonly exitCode?: number | null;

    constructor(message: string, tail?: string, exitCode?: number | null) {
      super(message);
      this.name = 'SkillsCliError';
      this.tail = tail;
      this.exitCode = exitCode;
    }
  },
}));

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  SkillsCliError,
}));

import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';
import * as revalidation from '@/features/skills/use-skills-revalidation';
import { useSkillsNonce } from '@/features/skills/use-skills-revalidation';

function makeEntry(overrides: Partial<SkillsCliEntry> & { name: string; scope: 'project' | 'global' }): SkillsCliEntry {
  return {
    source: 'shadcn/ui',
    sourceType: 'github',
    skillPath: `skills/${overrides.name}/SKILL.md`,
    ...overrides,
  };
}

const ENTRIES_A: SkillsCliEntry[] = [makeEntry({ name: 'shadcn', scope: 'project' })];
const ENTRIES_B: SkillsCliEntry[] = [
  makeEntry({ name: 'shadcn', scope: 'project' }),
  makeEntry({ name: 'linear', scope: 'global' }),
];

const INITIAL_STATE = {
  status: 'idle' as const,
  entries: [] as SkillsCliEntry[],
  probe: null,
  installing: false,
  uninstallingKey: null,
  failure: null,
};

beforeEach(() => {
  act(() => {
    useSkillsCliStore.setState(INITIAL_STATE);
  });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. loadManifest — available case
// ---------------------------------------------------------------------------

describe('useSkillsCliStore.loadManifest — available', () => {
  it('sets loading synchronously, then entries and status once the fetch resolves', async () => {
    let resolveFetch!: (v: { status: 'available'; entries: SkillsCliEntry[] }) => void;
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockImplementation(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }),
    );

    const { result } = renderHook(() => useSkillsCliStore());

    act(() => {
      void result.current.loadManifest('proj-a');
    });
    expect(result.current.status).toBe('loading');

    await act(async () => {
      resolveFetch({ status: 'available', entries: ENTRIES_A });
    });

    expect(result.current.status).toBe('available');
    expect(result.current.entries).toEqual(ENTRIES_A);
  });
});

// ---------------------------------------------------------------------------
// 2. loadManifest — unavailable case
// ---------------------------------------------------------------------------

describe('useSkillsCliStore.loadManifest — unavailable', () => {
  it('sets status "unavailable", not "error"', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'unavailable',
      executable: 'skills',
      packageRunner: 'npx skills',
    });

    const { result } = renderHook(() => useSkillsCliStore());

    await act(async () => {
      await result.current.loadManifest('proj-a');
    });

    expect(result.current.status).toBe('unavailable');
    expect(result.current.status).not.toBe('error');
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. install
// ---------------------------------------------------------------------------

describe('useSkillsCliStore.install', () => {
  it('success bumps the skills-revalidation nonce before re-reading the manifest', async () => {
    const calls: string[] = [];
    const realBump = revalidation.bumpSkillsRevalidation;
    vi.spyOn(revalidation, 'bumpSkillsRevalidation').mockImplementation(() => {
      calls.push('bump');
      realBump();
    });
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockImplementation(async () => {
      calls.push('manifest');
      return { status: 'available', entries: ENTRIES_B };
    });
    vi.mocked(skillsCliApi.installSkills).mockResolvedValue(undefined);

    const { result: nonceResult } = renderHook(() => useSkillsNonce());
    const nonceBefore = nonceResult.current;

    const { result } = renderHook(() => useSkillsCliStore());
    calls.length = 0;

    await act(async () => {
      await result.current.install('proj-a', 'shadcn/ui', ['shadcn'], 'project');
    });

    expect(calls).toEqual(['bump', 'manifest']);
    expect(nonceResult.current).toBe(nonceBefore + 1);
    expect(result.current.entries).toEqual(ENTRIES_B);
  });

  it('failure records {message, tail}, still re-reads the manifest, and does not bump the nonce', async () => {
    vi.mocked(skillsCliApi.installSkills).mockRejectedValue(
      new skillsCliApi.SkillsCliError('Install failed', 'boom output tail', 1),
    );
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: ENTRIES_A });

    const { result: nonceResult } = renderHook(() => useSkillsNonce());
    const nonceBefore = nonceResult.current;

    const { result } = renderHook(() => useSkillsCliStore());

    await act(async () => {
      await result.current.install('proj-a', 'shadcn/ui', ['shadcn'], 'project');
    });

    expect(result.current.failure).toEqual({ message: 'Install failed', tail: 'boom output tail' });
    expect(skillsCliApi.getSkillsCliManifest).toHaveBeenCalled();
    expect(result.current.entries).toEqual(ENTRIES_A);
    expect(nonceResult.current).toBe(nonceBefore);
  });
});

// ---------------------------------------------------------------------------
// 5. uninstall mirrors install
// ---------------------------------------------------------------------------

describe('useSkillsCliStore.uninstall', () => {
  it('success bumps the nonce and re-reads the manifest', async () => {
    vi.mocked(skillsCliApi.uninstallSkills).mockResolvedValue(undefined);
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: ENTRIES_A });

    const { result: nonceResult } = renderHook(() => useSkillsNonce());
    const nonceBefore = nonceResult.current;

    const { result } = renderHook(() => useSkillsCliStore());

    await act(async () => {
      await result.current.uninstall('proj-a', ['shadcn'], 'project');
    });

    expect(nonceResult.current).toBe(nonceBefore + 1);
    expect(result.current.entries).toEqual(ENTRIES_A);
  });

  it('failure records {message, tail} and still re-reads the manifest — never an optimistic removal', async () => {
    vi.mocked(skillsCliApi.uninstallSkills).mockRejectedValue(
      new skillsCliApi.SkillsCliError('Uninstall failed', 'tail here', 1),
    );
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: ENTRIES_B });

    const { result } = renderHook(() => useSkillsCliStore());

    await act(async () => {
      await result.current.uninstall('proj-a', ['shadcn'], 'project');
    });

    expect(result.current.failure).toEqual({ message: 'Uninstall failed', tail: 'tail here' });
    // Not optimistically removed: the entry is still present because the re-read said so.
    expect(result.current.entries).toEqual(ENTRIES_B);
  });
});

// ---------------------------------------------------------------------------
// 6. loadManifest — stale-response guard
// ---------------------------------------------------------------------------

describe('useSkillsCliStore.loadManifest — stale-response guard', () => {
  it('discards a late response from an earlier project once a newer load has started', async () => {
    let resolveA!: (v: { status: 'available'; entries: SkillsCliEntry[] }) => void;
    const slowA = new Promise<{ status: 'available'; entries: SkillsCliEntry[] }>((res) => {
      resolveA = res;
    });
    vi.mocked(skillsCliApi.getSkillsCliManifest)
      .mockImplementationOnce(() => slowA)
      .mockResolvedValueOnce({ status: 'available', entries: ENTRIES_B });

    const { result } = renderHook(() => useSkillsCliStore());

    let pA!: Promise<void>;
    act(() => {
      pA = result.current.loadManifest('proj-a');
    });

    await act(async () => {
      await result.current.loadManifest('proj-b');
    });

    await act(async () => {
      resolveA({ status: 'available', entries: ENTRIES_A });
      await pA;
    });

    expect(result.current.entries).toEqual(ENTRIES_B);
  });
});

// ---------------------------------------------------------------------------
// 7. reset()
// ---------------------------------------------------------------------------

describe('useSkillsCliStore.reset', () => {
  it('clears manifest, probe and failure state', () => {
    act(() => {
      useSkillsCliStore.setState({
        status: 'available',
        entries: ENTRIES_A,
        probe: { status: 'probed', skills: [{ name: 'shadcn', description: 'x' }] },
        failure: { message: 'boom' },
      });
    });

    const { result } = renderHook(() => useSkillsCliStore());

    act(() => {
      result.current.reset();
    });

    expect(result.current.entries).toEqual([]);
    expect(result.current.probe).toBeNull();
    expect(result.current.failure).toBeNull();
  });
});
