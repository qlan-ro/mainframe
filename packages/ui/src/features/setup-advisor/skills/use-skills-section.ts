'use client';

/**
 * useSkillsSection — the Skills section's own fetch, scoped to the active
 * adapter and project, plus the delete it owns.
 *
 * It fetches independently of the sidebar panel and the composer `/` trigger
 * for the same reason those two fetch independently of each other (see
 * `use-sidebar-skills.ts`); the shared revalidation nonce is what keeps the
 * three consistent after a delete.
 *
 * `remove` lives here so the identity never leaves the hook: the component
 * gets no `projectPath` it could pass to an API, only an opaque `identityKey`
 * it uses to drop a selection that outlived the project that produced it.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Skill } from '@qlan-ro/mainframe-types';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { getSkills, deleteSkill } from '@/lib/api/skills';
import { ApiRequestError } from '@/lib/api/http';
import { bumpSkillsRevalidation, useSkillsNonce } from '@/features/skills/use-skills-revalidation';

export type SkillsSectionState =
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; skills: Skill[] };

export interface SkillsSectionApi {
  state: SkillsSectionState;
  /** Opaque; changes whenever the fetch scope does. Never parsed or displayed. */
  identityKey: string;
  reload: () => void;
  remove: (skillId: string) => Promise<void>;
}

/** The daemon answers 404 for exactly one reason: this adapter has no skills. */
const NOT_SUPPORTED_STATUS = 404;

function classify(err: unknown): SkillsSectionState {
  if (err instanceof ApiRequestError && err.status === NOT_SUPPORTED_STATUS) return { status: 'unsupported' };
  return { status: 'error', message: err instanceof Error ? err.message : String(err) };
}

export function useSkillsSection(): SkillsSectionApi {
  const port = useDaemonPort();
  const { projectPath, adapterId } = useActiveIdentity();
  const adapter = adapterId ?? 'claude';
  const nonce = useSkillsNonce();
  const [reloadSeq, setReloadSeq] = useState(0);
  const [state, setState] = useState<SkillsSectionState>({ status: 'loading' });

  useEffect(() => {
    if (!projectPath) {
      setState({ status: 'empty' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const skills = await getSkills(port, adapter, projectPath);
        if (!cancelled) setState(skills.length === 0 ? { status: 'empty' } : { status: 'ready', skills });
      } catch (err) {
        console.warn('[skills-section] list failed', err);
        if (!cancelled) setState(classify(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [port, adapter, projectPath, nonce, reloadSeq]);

  const reload = useCallback(() => setReloadSeq((seq) => seq + 1), []);

  const remove = useCallback(
    async (skillId: string) => {
      if (!projectPath) throw new Error('No active project');
      try {
        await deleteSkill(port, adapter, skillId, projectPath);
      } finally {
        // Unconditional: a failed delete may still have changed the disk, so
        // every read surface refetches rather than trusting the response.
        bumpSkillsRevalidation();
      }
    },
    [port, adapter, projectPath],
  );

  return { state, identityKey: `${adapter} ${projectPath ?? ''}`, reload, remove };
}
