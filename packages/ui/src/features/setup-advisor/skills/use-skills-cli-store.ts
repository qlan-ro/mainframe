/**
 * use-skills-cli-store — data store for the advisor's Skills section.
 *
 * The daemon is authoritative: every operation, success or failure, re-reads
 * the manifest instead of mutating the list locally (spec AC 12), so a failed
 * uninstall leaves the row exactly as the CLI left it on disk. A success also
 * bumps the shared skills-revalidation nonce first, so the composer `/`
 * popover and the sidebar Skills tab refetch alongside this section.
 *
 * Stale-completion guards are module-level counters (`_loadSeq`, `_probeSeq`),
 * the `use-setup-advisor-store.ts` idiom — outside React so they survive
 * renders, outside the store so a `set()` cannot reset them.
 */
import { create } from 'zustand';
import type { SkillsCliEntry, SkillsCliProbe, SkillsCliScope } from '@qlan-ro/mainframe-types';
import { getSkillsCliManifest, probeSkillsSource, installSkills, uninstallSkills } from '@/lib/api/skills-cli';
import { bumpSkillsRevalidation } from '@/features/skills/use-skills-revalidation';
import { mfToast } from '@/lib/toast';

let _loadSeq = 0;
let _probeSeq = 0;

export type SkillsCliStatus = 'idle' | 'loading' | 'available' | 'unavailable' | 'error';

export interface SkillsCliFailure {
  message: string;
  tail?: string;
}

export interface SkillsCliUnavailableInfo {
  executable: string;
  packageRunner: string;
}

interface SkillsCliState {
  status: SkillsCliStatus;
  /**
   * Whether the manifest has ever finished a read. `status` returns to
   * `loading` on every refetch, so it cannot tell a first read from a refresh —
   * and the list may only blank itself for the first one.
   */
  loaded: boolean;
  entries: SkillsCliEntry[];
  unavailable: SkillsCliUnavailableInfo | null;
  error: string | null;
  probe: SkillsCliProbe | null;
  probing: boolean;
  probeError: string | null;
  installing: boolean;
  uninstallingKey: string | null;
  failure: SkillsCliFailure | null;
  loadManifest: (projectId: string, adapterId?: string) => Promise<void>;
  runProbe: (projectId: string, source: string, adapterId?: string) => Promise<void>;
  install: (
    projectId: string,
    source: string,
    skills: string[],
    scope: SkillsCliScope,
    adapterId?: string,
  ) => Promise<boolean>;
  uninstall: (projectId: string, skills: string[], scope: SkillsCliScope, adapterId?: string) => Promise<boolean>;
  reset: () => void;
}

/** Identity of one manifest row; also the in-flight key for its Uninstall button. */
export const skillKey = (scope: SkillsCliScope, name: string): string => `${scope}:${name}`;

/** The 502 body's `tail` rides on `SkillsCliError`; read it structurally so a plain Error still lands. */
function toFailure(err: unknown): SkillsCliFailure {
  const message = err instanceof Error ? err.message : 'The skills CLI failed';
  const tail = (err as { tail?: unknown }).tail;
  return typeof tail === 'string' && tail.length > 0 ? { message, tail } : { message };
}

export const useSkillsCliStore = create<SkillsCliState>((set, get) => ({
  status: 'idle',
  loaded: false,
  entries: [],
  unavailable: null,
  error: null,
  probe: null,
  probing: false,
  probeError: null,
  installing: false,
  uninstallingKey: null,
  failure: null,

  loadManifest: async (projectId, adapterId) => {
    const seq = ++_loadSeq;
    set({ status: 'loading', error: null });
    try {
      const manifest = await getSkillsCliManifest(projectId, adapterId);
      if (seq !== _loadSeq) return;
      if (manifest.status === 'unavailable') {
        const { executable, packageRunner } = manifest;
        set({ status: 'unavailable', loaded: true, unavailable: { executable, packageRunner }, entries: [] });
        return;
      }
      set({ status: 'available', loaded: true, unavailable: null, entries: manifest.entries });
    } catch (err) {
      if (seq !== _loadSeq) return;
      set({
        status: 'error',
        loaded: true,
        error: err instanceof Error ? err.message : 'Could not read the skills manifest',
      });
    }
  },

  runProbe: async (projectId, source, adapterId) => {
    const seq = ++_probeSeq;
    set({ probing: true, probe: null, probeError: null });
    try {
      const probe = await probeSkillsSource(projectId, source, adapterId);
      if (seq !== _probeSeq) return;
      set({ probing: false, probe });
    } catch (err) {
      if (seq !== _probeSeq) return;
      // A probe that fails and one that cannot be parsed degrade the same way:
      // manual skill-name entry, never a printed command.
      set({ probing: false, probe: { status: 'unparseable' }, probeError: toFailure(err).message });
    }
  },

  install: async (projectId, source, skills, scope, adapterId) => {
    set({ installing: true, failure: null });
    let ok = false;
    try {
      await installSkills(projectId, source, skills, scope, adapterId);
      bumpSkillsRevalidation();
      mfToast.success(skills.length === 1 ? 'Skill installed' : 'Skills installed', { description: skills.join(', ') });
      ok = true;
    } catch (err) {
      const failure = toFailure(err);
      set({ failure });
      mfToast.error('Install failed', { description: failure.message });
    }
    set({ installing: false, ...(ok ? { probe: null, probeError: null } : {}) });
    await get().loadManifest(projectId, adapterId);
    return ok;
  },

  uninstall: async (projectId, skills, scope, adapterId) => {
    set({ uninstallingKey: skillKey(scope, skills[0] ?? ''), failure: null });
    let ok = false;
    try {
      await uninstallSkills(projectId, skills, scope, adapterId);
      bumpSkillsRevalidation();
      mfToast.success(skills.length === 1 ? 'Skill removed' : 'Skills removed', { description: skills.join(', ') });
      ok = true;
    } catch (err) {
      const failure = toFailure(err);
      set({ failure });
      mfToast.error('Uninstall failed', { description: failure.message });
    }
    set({ uninstallingKey: null });
    await get().loadManifest(projectId, adapterId);
    return ok;
  },

  reset: () => {
    _loadSeq++;
    _probeSeq++;
    set({
      status: 'idle',
      loaded: false,
      entries: [],
      unavailable: null,
      error: null,
      probe: null,
      probing: false,
      probeError: null,
      installing: false,
      uninstallingKey: null,
      failure: null,
    });
  },
}));
