import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { getProviderSettings } from '@/lib/api/settings';
import { getDraftConfig, setDraftConfig, type DraftCfg } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';
import { resolveDefaultAdapterId } from './default-adapter';
import { resolveDraftDefaults } from './resolve-draft-defaults';

export interface InitializeDraftArgs {
  localId: string;
  /** null means "No project" (todo #346). */
  projectId: string | null;
  port: number;
  defaultAdapterId: string | null;
  adapters: AdapterInfo[];
  adapterId?: string;
  /**
   * Carried straight into the snapshot this call writes, iff this call's own
   * attempt wins the race (todo #346). Passing it in — rather than
   * patching it on afterward — means a SUPERSEDED call never patches at all:
   * it returns before `setDraftConfig` runs, so it can't leak its captured
   * `temporary` onto whichever later draft actually won the slot.
   */
  temporary?: boolean;
}

export async function initializeDraft(args: InitializeDraftArgs): Promise<DraftCfg> {
  const retry = () => initializeDraft(args);
  const store = useNewThreadReady.getState();
  const attempt = store.beginInitialization(args.localId, retry);

  try {
    const providers = await getProviderSettings(args.port);
    const adapterId = args.adapterId ?? resolveDefaultAdapterId(args.defaultAdapterId, args.adapters);
    const adapter = args.adapters.find((candidate) => candidate.id === adapterId);
    if (!adapter) throw new Error(`Cannot initialize draft: adapter ${adapterId} is unavailable`);
    const resolved = resolveDraftDefaults(args.projectId, adapter, providers[adapterId]);
    const snapshot: DraftCfg = args.temporary !== undefined ? { ...resolved, temporary: args.temporary } : resolved;
    const initialization = useNewThreadReady.getState().getInitialization(args.localId);
    if (initialization.attempt !== attempt) return getDraftConfig(args.localId) ?? snapshot;
    setDraftConfig(args.localId, snapshot);
    useNewThreadReady.getState().completeInitialization(args.localId, attempt);
    useNewThreadReady.getState().markReady(args.localId);
    return snapshot;
  } catch (error) {
    useNewThreadReady.getState().failInitialization(args.localId, attempt, error);
    throw error;
  }
}

export async function reinitializeDraftAdapter(args: InitializeDraftArgs & { adapterId: string }): Promise<DraftCfg> {
  const existing = getDraftConfig(args.localId);
  if (!existing || !useNewThreadReady.getState().isReady(args.localId)) {
    throw new Error(`Cannot reinitialize draft: ${args.localId} has no ready snapshot`);
  }
  const attempt = useNewThreadReady.getState().beginReadyReplacement(args.localId);

  try {
    const providers = await getProviderSettings(args.port);
    const adapter = args.adapters.find((candidate) => candidate.id === args.adapterId);
    if (!adapter) throw new Error(`Cannot initialize draft: adapter ${args.adapterId} is unavailable`);
    const resolved = resolveDraftDefaults(args.projectId, adapter, providers[args.adapterId]);
    const initialization = useNewThreadReady.getState().getInitialization(args.localId);
    const current = getDraftConfig(args.localId);
    if (initialization.attempt !== attempt || !current) return current ?? resolved;
    const snapshot: DraftCfg = {
      ...resolved,
      ...(current.worktreePath !== undefined ? { worktreePath: current.worktreePath } : {}),
      ...(current.branchName !== undefined ? { branchName: current.branchName } : {}),
      ...(current.pendingWorktree !== undefined ? { pendingWorktree: current.pendingWorktree } : {}),
      // Switching adapters must not silently drop the user's temporary choice (todo #346).
      ...(current.temporary !== undefined ? { temporary: current.temporary } : {}),
    };
    setDraftConfig(args.localId, snapshot);
    useNewThreadReady.getState().completeInitialization(args.localId, attempt);
    return snapshot;
  } catch (error) {
    useNewThreadReady.getState().completeInitialization(args.localId, attempt);
    throw error;
  }
}
