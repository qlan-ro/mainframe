'use client';

/**
 * Per-chat skills provider + hook.
 *
 * Preloads the skills available for the current chat's adapter + project once
 * on mount (when port/adapterId/projectId are known). Holds plain React state —
 * same pattern as `useAdapters` in `use-composer-tuning.ts`.
 *
 * Usage:
 *   // In the chat thread root:
 *   <SkillsProvider>…children…</SkillsProvider>
 *
 *   // In any descendant:
 *   const { skills, loading } = useChatSkills();
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Skill } from '@qlan-ro/mainframe-types';
import { getProjects } from '@/lib/api/projects';
import { getSkills } from '@/lib/api/skills';
import { useChatExtras } from '../chat/runtime/use-chat-thread-runtime';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ChatSkills {
  skills: Skill[];
  loading: boolean;
}

const DEFAULT: ChatSkills = { skills: [], loading: false };
const Ctx = createContext<ChatSkills>(DEFAULT);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SkillsProvider({ children }: { children: ReactNode }) {
  const extras = useChatExtras();
  const port = extras?.port ?? null;
  const adapterId = extras?.state.chatConfig?.adapterId ?? null;
  const projectId = extras?.state.chatConfig?.projectId ?? null;

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (port == null || !adapterId || !projectId) return;

    let cancelled = false;
    // Clear stale skills from a previous adapter/project so consumers never see
    // wrong-project skills during the in-flight refetch when the chat config changes.
    setSkills([]);
    setLoading(true);

    void (async () => {
      try {
        const projects = await getProjects(port);
        const path = projects.find((p) => p.id === projectId)?.path;
        if (!path) {
          if (!cancelled) setSkills([]);
          return;
        }
        const list = await getSkills(port, adapterId, path);
        if (!cancelled) setSkills(list);
      } catch (err) {
        console.warn('[skills] failed to load skills', err);
        if (!cancelled) setSkills([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [port, adapterId, projectId]);

  return <Ctx.Provider value={{ skills, loading }}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatSkills(): ChatSkills {
  return useContext(Ctx);
}
