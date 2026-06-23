'use client';

/**
 * Sidebar-local skills + agents fetch for the bottom panel.
 *
 * The chat thread's SkillsProvider cannot be reused here: it reads per-thread
 * `useChatExtras()` state that only exists inside the active thread runtime, not
 * in the sidebar tree. So the panel fetches independently, keyed off the active
 * session's project path AND adapter (useActiveIdentity) — so a non-Claude
 * session shows its own adapter's skills/agents, not Claude's. Falls back to
 * 'claude' when no session is active.
 */
import { useEffect, useState } from 'react';
import type { Skill, AgentConfig } from '@qlan-ro/mainframe-types';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { getSkills } from '@/lib/api/skills';
import { getAgents } from '@/lib/api/agents';

export function useSidebarSkills(): { skills: Skill[]; agents: AgentConfig[]; loading: boolean } {
  const port = useDaemonPort();
  const { projectPath, adapterId } = useActiveIdentity();
  const adapter = adapterId ?? 'claude';
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectPath) {
      setSkills([]);
      setAgents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setSkills([]);
    setAgents([]);
    setLoading(true);
    void (async () => {
      try {
        const [skillList, agentList] = await Promise.all([
          getSkills(port, adapter, projectPath),
          getAgents(port, adapter, projectPath),
        ]);
        if (!cancelled) {
          setSkills(skillList);
          setAgents(agentList);
        }
      } catch (err) {
        console.warn('[sidebar-skills] failed', err);
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
  }, [port, projectPath, adapter]);

  return { skills, agents, loading };
}
