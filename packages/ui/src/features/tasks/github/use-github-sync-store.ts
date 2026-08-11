/**
 * Zustand store for the GitHub sync surface of the Tasks board.
 *
 * Holds the link, the pairs (keyed by todoId), the last run, and the dialog
 * the board is showing. `port` and `projectId` are held here — unlike
 * `use-todos-store`, which threads them per call — because the header control,
 * the row glyphs, and four dialogs all act on the same project and would
 * otherwise each have to carry them.
 *
 * Mutations that change a task refetch both this store and the todos store
 * (refetch-on-mutation; the todos plugin broadcasts no event). Link-level
 * mutations touch no task and refetch only this store.
 *
 * Stale-completion guard: `_loadSeq` mirrors `use-todos-store` — a slower
 * earlier `load()` is dropped once a newer one has started.
 */
import { create } from 'zustand';
import {
  getLink,
  linkRepo as apiLinkRepo,
  unlinkRepo as apiUnlinkRepo,
  listPairs,
  deletePair,
  listIssues,
  importIssues as apiImportIssues,
  publishTask,
  runSync,
  getReport,
  type Link,
  type LinkInput,
  type Pair,
  type RemoteIssue,
  type Report,
  type RunSummary,
  type WorkflowLabelSet,
} from '@/lib/api/todos-github';
import type { Todo } from '@/lib/api/todos';
import { ApiRequestError } from '@/lib/api/http';
import { useTodosStore } from '../use-todos-store';

export type GitHubSyncDialog =
  | null
  | { kind: 'link' }
  | { kind: 'import' }
  | { kind: 'publish'; todo: Todo }
  | { kind: 'report' }
  | { kind: 'token'; returnTo?: 'import' };

interface GitHubSyncState {
  port: number | null;
  projectId: string | null;
  link: Link | null;
  /** The reserved-label denylist, fetched from the daemon — see `workflow-labels.ts`. */
  workflowLabels: WorkflowLabelSet;
  /** Keyed by todoId — the pairing key is never the reusable task number. */
  pairs: Record<string, Pair>;
  running: boolean;
  lastRun: RunSummary | null;
  report: Report | null;
  issues: RemoteIssue[];
  loading: boolean;
  error: string | null;
  /** The last `error` was GitHub refusing our credential — offer the token fix, not a retry. */
  errorAuth: boolean;
  dialog: GitHubSyncDialog;
  bannerDismissed: boolean;
  init: (port: number, projectId: string) => void;
  load: () => Promise<void>;
  openDialog: (dialog: GitHubSyncDialog) => void;
  closeDialog: () => void;
  linkRepo: (input: LinkInput) => Promise<void>;
  unlinkRepo: () => Promise<void>;
  loadIssues: () => Promise<void>;
  importIssues: (issueNumbers: number[]) => Promise<void>;
  publish: (todoId: string) => Promise<void>;
  unlinkPair: (todoId: string) => Promise<void>;
  sync: () => Promise<void>;
  loadReport: (runId?: string) => Promise<void>;
  dismissBanner: () => void;
}

// Monotonic counter — lives outside React/Zustand so it persists across renders.
let _loadSeq = 0;

const EMPTY_WORKFLOW_LABELS: WorkflowLabelSet = { prefixes: [], labels: [] };

const messageOf = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

export const useGitHubSyncStore = create<GitHubSyncState>((set, get) => {
  /** Refetch this store only — for mutations that write no task. */
  const reload = (): Promise<void> => get().load();

  /** Refetch this store and the todos board — for mutations that create or change a task. */
  const reloadWithTasks = async (): Promise<void> => {
    const { port, projectId } = get();
    await reload();
    if (port !== null && projectId !== null) await useTodosStore.getState().load(port, projectId);
  };

  return {
    port: null,
    projectId: null,
    link: null,
    workflowLabels: EMPTY_WORKFLOW_LABELS,
    pairs: {},
    running: false,
    lastRun: null,
    report: null,
    issues: [],
    loading: false,
    error: null,
    errorAuth: false,
    dialog: null,
    bannerDismissed: false,

    init: (port, projectId) => set({ port, projectId }),

    load: async () => {
      const { port, projectId } = get();
      if (port === null || projectId === null) return;
      const seq = ++_loadSeq;
      set({ loading: true, error: null, errorAuth: false });
      try {
        const [status, pairs] = await Promise.all([getLink(port, projectId), listPairs(port, projectId)]);
        if (seq !== _loadSeq) return;
        set({
          link: status.link,
          running: status.running,
          workflowLabels: status.workflowLabels,
          pairs: Object.fromEntries(pairs.map((pair) => [pair.todoId, pair])),
          loading: false,
        });
      } catch (err) {
        if (seq !== _loadSeq) return;
        set({ loading: false, error: messageOf(err, 'Failed to load the GitHub sync state') });
      }
    },

    /**
     * The import and report dialogs render whatever the store holds, so the
     * open action fetches it — whichever control opened them. Both fetches
     * record their own failure in `error` rather than rejecting into a caller
     * that has nowhere to put it.
     */
    openDialog: (dialog) => {
      set({ dialog });
      if (dialog?.kind === 'import') void get().loadIssues();
      if (dialog?.kind === 'report') void get().loadReport();
    },

    closeDialog: () => set({ dialog: null }),

    linkRepo: async (input) => {
      const { port } = get();
      if (port === null) return;
      await apiLinkRepo(port, input);
      await reload();
    },

    unlinkRepo: async () => {
      const { port, projectId } = get();
      if (port === null || projectId === null) return;
      await apiUnlinkRepo(port, projectId);
      await reload();
    },

    loadIssues: async () => {
      const { port, projectId } = get();
      if (port === null || projectId === null) return;
      set({ error: null, errorAuth: false });
      try {
        set({ issues: await listIssues(port, projectId) });
      } catch (err) {
        // 503 is the daemon's "integration not ready to talk to GitHub" —
        // a missing or rejected credential. The raw message embeds GitHub's
        // JSON body, so it is replaced, not shown.
        const auth = err instanceof ApiRequestError && err.status === 503;
        set({
          error: auth
            ? 'GitHub rejected the stored credential — the token is missing, expired, or revoked.'
            : messageOf(err, 'Failed to load the repository issues'),
          errorAuth: auth,
        });
      }
    },

    importIssues: async (issueNumbers) => {
      const { port, projectId } = get();
      if (port === null || projectId === null) return;
      await apiImportIssues(port, projectId, issueNumbers);
      await reloadWithTasks();
    },

    publish: async (todoId) => {
      const { port, projectId } = get();
      if (port === null || projectId === null) return;
      await publishTask(port, projectId, todoId);
      await reloadWithTasks();
    },

    unlinkPair: async (todoId) => {
      const { port } = get();
      if (port === null) return;
      await deletePair(port, todoId);
      await reloadWithTasks();
    },

    sync: async () => {
      const { port, projectId, running } = get();
      if (running || port === null || projectId === null) return;
      set({ running: true, error: null });
      try {
        const run = await runSync(port, projectId);
        // The previous run's report is stale the moment a new run finishes;
        // the report dialog refetches on open.
        set({ lastRun: run, report: null, bannerDismissed: false });
        await reloadWithTasks();
      } finally {
        set({ running: false });
      }
    },

    loadReport: async (runId) => {
      const { port, projectId } = get();
      if (port === null || projectId === null) return;
      try {
        set({ report: await getReport(port, projectId, runId) });
      } catch (err) {
        set({ error: messageOf(err, 'Failed to load the sync report') });
      }
    },

    dismissBanner: () => set({ bannerDismissed: true }),
  };
});
