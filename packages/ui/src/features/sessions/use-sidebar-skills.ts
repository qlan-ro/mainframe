'use client';

/**
 * Session-scoped skills fetch for the session panel's Skills sub-group.
 *
 * The chat thread's SkillsProvider cannot be reused here: it reads per-thread
 * `useChatExtras()` state that only exists inside the active thread runtime, not
 * in the panel tree. So the panel fetches independently, keyed off the active
 * session's project path AND adapter (useActiveIdentity) — so a non-Claude
 * session shows its own adapter's skills, not Claude's. Falls back to 'claude'
 * when no session is active.
 */
import { useEffect, useState } from 'react';
import type { Skill } from '@qlan-ro/mainframe-types';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { getSkills } from '@/lib/api/skills';
import { useSkillsNonce } from '@/features/skills/use-skills-revalidation';

export function useSidebarSkills(): { skills: Skill[]; loading: boolean } {
  const port = useDaemonPort();
  const { projectPath, adapterId } = useActiveIdentity();
  const adapter = adapterId ?? 'claude';
  const nonce = useSkillsNonce();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectPath) {
      setSkills([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setSkills([]);
    setLoading(true);
    void (async () => {
      try {
        const skillList = await getSkills(port, adapter, projectPath);
        if (!cancelled) setSkills(skillList);
      } catch (err) {
        console.warn('[sidebar-skills] failed', err);
        if (!cancelled) setSkills([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [port, projectPath, adapter, nonce]);

  return { skills, loading };
}
