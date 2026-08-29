'use client';

/**
 * Per-chat skills + agents provider and hooks.
 *
 * Preloads the skills and agents available for the current chat's adapter +
 * project once on mount (when port/adapterId/projectId are known). Holds plain
 * React state — same pattern as `useAdapters` in `use-composer-tuning.ts`.
 *
 * Usage:
 *   // In the chat thread root:
 *   <SkillsProvider>…children…</SkillsProvider>
 *
 *   // In any descendant:
 *   const { skills, agents, loading } = useChatSkills();
 *   const agents = useChatAgents();
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Skill, AgentConfig, CustomCommand } from '@qlan-ro/mainframe-types';
import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';
import { getAgents } from '@/lib/api/agents';
import { getCommands } from '@/lib/api/commands';
import { publishCommands } from '../chat/commands/command-registry';
import { useChatExtras } from '../chat/runtime/chat-extras';
import { useDraftConfig } from '../sessions/runtime/draft-config';
import { resolveDraftChatContext } from '../chat/composer/triggers/resolve-draft-chat-context';
import { useSkillsNonce } from './use-skills-revalidation';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ChatSkills {
  skills: Skill[];
  agents: AgentConfig[];
  /** Daemon slash commands. Global, so they survive an adapter/project change. */
  commands: CustomCommand[];
  loading: boolean;
}

const DEFAULT: ChatSkills = { skills: [], agents: [], commands: [], loading: false };
const Ctx = createContext<ChatSkills>(DEFAULT);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Runs one list fetch to completion without ever rejecting, so a failing skills
 * fetch cannot empty the agents picker (or the reverse).
 */
async function loadList<T>(label: string, fetch: () => Promise<T[]>, apply: (items: T[]) => void): Promise<void> {
  try {
    apply(await fetch());
  } catch (err) {
    console.warn(`[skills] failed to load ${label}`, err);
    apply([]);
  }
}

export function SkillsProvider({ children }: { children: ReactNode }) {
  const extras = useChatExtras();
  const port = extras?.port ?? null;
  const chatId = extras?.state.chatId ?? null;
  const chatConfig = extras?.state.chatConfig ?? null;
  // Draft-aware: a brand-new __LOCALID_* thread has no daemon chatConfig yet, so
  // fall back to the in-memory draft's project + adapter (see resolveDraftChatContext)
  // so the `/` skills and `@` agents pickers populate before the first send.
  const draft = useDraftConfig(chatId != null && chatConfig == null ? chatId : null);
  const { adapterId, projectId } = resolveDraftChatContext(chatId, chatConfig, draft);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const nonce = useSkillsNonce();

  // Commands need only the port — the registry behind `/api/commands` is static
  // and takes no project. Kept off the skills effect so the `/` picker offers
  // them on a fresh draft, before an adapter or project has been chosen.
  // Published to the module registry as well: the send path matches an
  // invocation from there, outside React (see command-registry).
  useEffect(() => {
    if (port == null) return;
    let cancelled = false;
    void loadList(
      'commands',
      () => getCommands(port),
      (items) => {
        if (cancelled) return;
        setCommands(items);
        publishCommands(items);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [port]);

  useEffect(() => {
    if (port == null || !adapterId || !projectId) return;

    let cancelled = false;
    // Clear stale skills and agents from a previous adapter/project so consumers
    // never see wrong-project data during the in-flight refetch when chat config changes.
    setSkills([]);
    setAgents([]);
    setLoading(true);

    void (async () => {
      try {
        const projects = await getProjects(port);
        const path = projects.find((p) => p.id === projectId)?.path;
        if (!path) {
          if (!cancelled) {
            setSkills([]);
            setAgents([]);
          }
          return;
        }
        await Promise.allSettled([
          loadList(
            'skills',
            () => getSkills(port, adapterId, path),
            (items) => {
              if (!cancelled) setSkills(items);
            },
          ),
          loadList(
            'agents',
            () => getAgents(port, adapterId, path),
            (items) => {
              if (!cancelled) setAgents(items);
            },
          ),
        ]);
      } catch (err) {
        console.warn('[skills] failed to resolve the project path', err);
        if (!cancelled) {
          setSkills([]);
          setAgents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [port, adapterId, projectId, nonce]);

  return <Ctx.Provider value={{ skills, agents, commands, loading }}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useChatSkills(): ChatSkills {
  return useContext(Ctx);
}

export function useChatAgents(): AgentConfig[] {
  return useContext(Ctx).agents;
}

// ---------------------------------------------------------------------------
// Skill name resolution (mirrors core's resolveSkillName — app-tauri must not
// depend on @qlan-ro/mainframe-core; this copy stays in sync with the source)
// ---------------------------------------------------------------------------

/**
 * Resolves a raw skill command name (e.g. `my-skill`) to its canonical
 * invocation name (e.g. `plugin:my-skill`) using the preloaded skills list.
 * Falls back to the raw name when no match is found (safe when skills is `[]`).
 */
export function resolveSkillName(name: string, skills: Skill[]): string {
  const exact = skills.find((s) => s.invocationName === name || s.name === name);
  if (exact) return exact.invocationName || exact.name;
  const suffix = skills.find((s) => s.invocationName?.endsWith(`:${name}`));
  if (suffix) return suffix.invocationName!;
  return name;
}
