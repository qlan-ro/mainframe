/**
 * useAutomationTriggerSources — builds the `/` (skills) and `@` (files)
 * TriggerConfig entries for an automations text field, sourced from the
 * automation's own `scopeProjectId` (no chat/session context) and an
 * explicit adapterId (or `useAdapters`' first installed adapter). Mirrors
 * `use-chat-skills.test.tsx`'s mocking strategy.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Project, Skill, AdapterInfo } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/projects', () => ({ getProjects: vi.fn() }));
vi.mock('@/lib/api/skills', () => ({ getSkills: vi.fn() }));
vi.mock('@/lib/api/files', () => ({
  searchFiles: vi.fn(async () => []),
  getFileTree: vi.fn(async () => []),
  browseFilesystem: vi.fn(async () => []),
}));

import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';
import { searchFiles } from '@/lib/api/files';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import { useAutomationsStore } from '../../data/use-automations-store';
import { useAutomationTriggerSources } from '../use-automation-trigger-sources';

const PROJECT_ID = 'p1';
const PROJECT_PATH = '/proj';
const ADAPTER_ID = 'claude';

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

function adapter(id: string, installed: boolean): AdapterInfo {
  return { id, name: id, description: '', installed, models: [], capabilities: { planMode: false } };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAdapters();
  useAutomationsStore.setState({ scopeProjectId: null });
});

describe('useAutomationTriggerSources', () => {
  it('always returns a "/" and "@" TriggerConfig, even before any project resolves', () => {
    const { result } = renderHook(() => useAutomationTriggerSources());
    expect(result.current.map((c) => c.char)).toEqual(['/', '@']);
  });

  it('loads skills for the given adapterId once scopeProjectId resolves', async () => {
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);

    const { result } = renderHook(() => useAutomationTriggerSources(ADAPTER_ID));

    await waitFor(() => {
      const slash = result.current.find((c) => c.char === '/')!;
      expect(slash.adapter.search!('')).toEqual([
        { id: 'my-skill', type: 'skill', label: 'My Skill', description: 'Does something useful' },
      ]);
    });

    expect(vi.mocked(getSkills)).toHaveBeenCalledExactlyOnceWith(0, ADAPTER_ID, PROJECT_PATH);
  });

  it('falls back to the first installed adapter from useAdapters when no adapterId is given', async () => {
    seedAdapters([adapter('codex', false), adapter('claude', true)]);
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([]);

    renderHook(() => useAutomationTriggerSources());

    await waitFor(() => expect(vi.mocked(getSkills)).toHaveBeenCalled());
    expect(vi.mocked(getSkills)).toHaveBeenCalledExactlyOnceWith(0, 'claude', PROJECT_PATH);
  });

  it('the "@" adapter searches files scoped to scopeProjectId, with no chatId', async () => {
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([]);

    const { result } = renderHook(() => useAutomationTriggerSources(ADAPTER_ID));
    const at = result.current.find((c) => c.char === '@')!;
    at.adapter.search!('read');

    await waitFor(() => expect(vi.mocked(searchFiles)).toHaveBeenCalledWith(0, PROJECT_ID, 'read'));
  });

  it('never fetches skills when disabled, even with a resolved project and adapter', async () => {
    useAutomationsStore.setState({ scopeProjectId: PROJECT_ID });
    vi.mocked(getProjects).mockResolvedValue([PROJECT_FIXTURE]);
    vi.mocked(getSkills).mockResolvedValue([SKILL_FIXTURE]);

    renderHook(() => useAutomationTriggerSources(ADAPTER_ID, { enabled: false }));

    // Flush any pending microtasks the effect might have queued before asserting the negative.
    await Promise.resolve();
    expect(vi.mocked(getProjects)).not.toHaveBeenCalled();
    expect(vi.mocked(getSkills)).not.toHaveBeenCalled();
  });
});
