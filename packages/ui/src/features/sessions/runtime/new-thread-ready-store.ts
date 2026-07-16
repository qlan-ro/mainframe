/**
 * new-thread-ready-store — the reactive bridge from the config picker to the
 * composer on a brand-new (__LOCALID_*) thread.
 *
 * The draft-config Map (`draft-config.ts`) is a plain module singleton — writing
 * to it does NOT re-render anything. So once project+adapter are chosen the picker
 * also marks the local id ready here; ChatSurface subscribes to this store and
 * switches the surface from the new-session picker / welcome flow to ChatThread
 * (which carries the real composer) so the user can type and send the first
 * message.
 *
 * Lifecycle: the picker marks ready; the new-thread coordinator clears it on the
 * first send (alongside clearing the draft) so a recycled local id starts fresh.
 * Used both as a React hook (ChatSurface/picker) and imperatively
 * (`useNewThreadReady.getState()`) from the non-React coordinator.
 */
import { create } from 'zustand';
import type { DraftCfg } from './draft-config';

export type DraftInitializationStatus = 'idle' | 'initializing' | 'ready' | 'error';

export interface DraftInitialization {
  status: DraftInitializationStatus;
  retry?: () => Promise<DraftCfg>;
  error?: unknown;
  attempt?: number;
}

const IDLE_INITIALIZATION: DraftInitialization = { status: 'idle' };
let nextInitializationAttempt = 0;

interface NewThreadReadyState {
  /** Local thread ids whose draft config is complete (project+adapter chosen). */
  readonly readyIds: ReadonlySet<string>;
  readonly initializations: ReadonlyMap<string, DraftInitialization>;
  isReady: (localId: string) => boolean;
  getInitialization: (localId: string) => DraftInitialization;
  beginInitialization: (localId: string, retry: () => Promise<DraftCfg>) => number;
  completeInitialization: (localId: string, attempt: number) => boolean;
  failInitialization: (localId: string, attempt: number, error: unknown) => void;
  cancelInitialization: (localId: string, attempt: number) => void;
  markReady: (localId: string) => void;
  clearReady: (localId: string) => void;
}

export const useNewThreadReady = create<NewThreadReadyState>((set, get) => ({
  readyIds: new Set<string>(),
  initializations: new Map<string, DraftInitialization>(),
  isReady: (localId) => get().readyIds.has(localId),
  getInitialization: (localId) => get().initializations.get(localId) ?? IDLE_INITIALIZATION,
  beginInitialization: (localId, retry) => {
    const attempt = ++nextInitializationAttempt;
    set((state) => {
      const initializations = new Map(state.initializations);
      initializations.set(localId, { status: 'initializing', retry, attempt });
      const readyIds = new Set(state.readyIds);
      readyIds.delete(localId);
      return { initializations, readyIds };
    });
    return attempt;
  },
  completeInitialization: (localId, attempt) => {
    if (get().initializations.get(localId)?.attempt !== attempt) return false;
    set((state) => {
      const initializations = new Map(state.initializations);
      const current = initializations.get(localId);
      initializations.set(localId, { status: 'ready', retry: current?.retry, attempt });
      return { initializations };
    });
    return true;
  },
  failInitialization: (localId, attempt, error) =>
    set((state) => {
      const current = state.initializations.get(localId);
      if (current?.attempt !== attempt) return state;
      const initializations = new Map(state.initializations);
      initializations.set(localId, { status: 'error', retry: current.retry, error, attempt });
      return { initializations };
    }),
  cancelInitialization: (localId, attempt) =>
    set((state) => {
      const current = state.initializations.get(localId);
      if (current?.status !== 'initializing' || current.attempt !== attempt) return state;
      const initializations = new Map(state.initializations);
      initializations.delete(localId);
      return { initializations };
    }),
  markReady: (localId) =>
    set((state) => {
      if (state.readyIds.has(localId)) return state; // stable ref — no churn
      const next = new Set(state.readyIds);
      next.add(localId);
      return { readyIds: next };
    }),
  clearReady: (localId) =>
    set((state) => {
      const next = new Set(state.readyIds);
      next.delete(localId);
      const initializations = new Map(state.initializations);
      initializations.delete(localId);
      if (next.size === state.readyIds.size && initializations.size === state.initializations.size) return state;
      return { readyIds: next, initializations };
    }),
}));
