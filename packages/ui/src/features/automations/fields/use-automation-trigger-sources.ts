'use client';

/**
 * Builds the `/` (skills) and `@` (files) `TriggerConfig` entries for an
 * automations text field — the automations-context analog of
 * `ComposerTriggers`' `useComposerTriggerConfigs`. Sourced from the
 * automation's own `scopeProjectId` (no chat/session context — `SkillsProvider`
 * is chat-coupled and can't be reused) and from `adapterId` (the agent step's
 * configured adapter, or — for the fields belonging to no step — the first
 * installed adapter that answers the skills route), mirroring
 * `use-chat-skills.tsx`'s project-path resolution.
 *
 * `getSkills`/`searchFiles`/etc.'s `port` param is vestigial (`apiBase`
 * ignores it) — same `IGNORED_PORT` convention as `use-project-branches.ts`,
 * so this hook needs no `DaemonPortProvider`. No `chatId` is passed to the
 * file APIs: automations have no chat/worktree context to scope search to.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Skill } from '@qlan-ro/mainframe-types';
import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';
import { searchFiles, getFileTree, browseFilesystem } from '@/lib/api/files';
import { useAdapters } from '@/store/adapters';
import { buildSkillsTriggerAdapter } from '@/features/chat/composer/triggers/skills-trigger-adapter';
import { createMentionCache } from '@/features/chat/composer/triggers/mention-adapter';
import { useMentionTriggerAdapter } from '@/features/chat/composer/triggers/use-mention-trigger-adapter';
import {
  literalDirectiveFormatter,
  mentionDirectiveFormatter,
  shouldCloseTriggerOnInsert,
} from '@/features/chat/composer/triggers/directive-formatter';
import type { TriggerConfig } from '@/components/trigger-engine/types';
import { useAutomationsStore } from '../data/use-automations-store';

const IGNORED_PORT = 0;

/**
 * Only the Claude adapter serves the skills route today (`routes/skills.rs`
 * answers 404 for the rest), and nothing in `AdapterInfo` says so — so a
 * candidate that rejects is a candidate that has no skills, and the next one
 * gets a turn. An adapter step passes exactly one candidate and never guesses.
 */
function useAutomationSkills(projectId: string | null, adapterIds: string[], enabled: boolean): Skill[] {
  const [skills, setSkills] = useState<Skill[]>([]);
  const candidateKey = adapterIds.join(',');

  useEffect(() => {
    const candidates = candidateKey ? candidateKey.split(',') : [];
    if (!enabled || !projectId || candidates.length === 0) {
      setSkills([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const projects = await getProjects(IGNORED_PORT);
        const path = projects.find((p) => p.id === projectId)?.path;
        if (!path) {
          if (!cancelled) setSkills([]);
          return;
        }
        for (const candidate of candidates) {
          try {
            const list = await getSkills(IGNORED_PORT, candidate, path);
            if (!cancelled) setSkills(list);
            return;
          } catch (err) {
            console.warn(`[automations-triggers] ${candidate} served no skills`, err);
          }
        }
        if (!cancelled) setSkills([]);
      } catch (err) {
        console.warn('[automations-triggers] failed to load skills', err);
        if (!cancelled) setSkills([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, candidateKey]);

  return skills;
}

export interface UseAutomationTriggerSourcesOptions {
  /**
   * Skips both the skills and files fetches. `TriggerTextField` must call this
   * hook from every instance regardless of `triggers` mode — a hook can't be
   * conditional — so `variables-only` fields like the worktree branch name
   * would otherwise fire a `getSkills`/file search they never read.
   */
  enabled?: boolean;
}

/** `adapterId`, when given, is the only adapter `/` lists skills from. */
export function useAutomationTriggerSources(
  adapterId?: string,
  { enabled = true }: UseAutomationTriggerSourcesOptions = {},
): TriggerConfig[] {
  const scopeProjectId = useAutomationsStore((s) => s.scopeProjectId);
  const adapters = useAdapters();
  const candidateAdapterIds = useMemo(
    () => (adapterId ? [adapterId] : adapters.filter((a) => a.installed).map((a) => a.id)),
    [adapterId, adapters],
  );

  const skills = useAutomationSkills(scopeProjectId, candidateAdapterIds, enabled);
  const skillsAdapter = useMemo(() => buildSkillsTriggerAdapter(skills), [skills]);

  const mentionCache = useMemo(
    () =>
      createMentionCache({
        searchFiles: (q) =>
          enabled && scopeProjectId ? searchFiles(IGNORED_PORT, scopeProjectId, q) : Promise.resolve([]),
        getFileTree: (dir) =>
          enabled && scopeProjectId ? getFileTree(IGNORED_PORT, scopeProjectId, dir) : Promise.resolve([]),
        browseFilesystem: (dir) =>
          enabled
            ? browseFilesystem(IGNORED_PORT, dir, { includeFiles: true, includeHidden: true })
            : Promise.resolve([]),
      }),
    [enabled, scopeProjectId],
  );

  // No agents: an automation step has no chat to source a subagent list from.
  const mentionAdapter = useMentionTriggerAdapter(mentionCache);

  return useMemo(
    () => [
      {
        char: '/',
        adapter: skillsAdapter,
        formatter: literalDirectiveFormatter('/'),
        itemTestIdPrefix: 'automations-skill-item',
      },
      {
        char: '@',
        adapter: mentionAdapter,
        formatter: mentionDirectiveFormatter(),
        itemTestIdPrefix: 'automations-file-item',
        closeOnInsert: shouldCloseTriggerOnInsert,
      },
    ],
    [skillsAdapter, mentionAdapter],
  );
}
