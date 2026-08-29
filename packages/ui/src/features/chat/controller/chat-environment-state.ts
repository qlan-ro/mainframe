/**
 * The environment slice of a chat thread's state — everything fed by the
 * side-band `/` WS dialect (`chat.updated` config, background tasks, workflow
 * runs, worktree offers), as opposed to the ACP facade plane (transcript, run
 * frames, gates, queue), which stays in `chat-thread-state.ts`. The split
 * follows the two-plane seam the controller composes; the reducer contract is
 * unchanged — `reduceChatThreadState` delegates these events here.
 */
import type { BackgroundActivityTask, Chat, ClaudeWorkflowRun, WorktreeSwitchOffer } from '@qlan-ro/mainframe-types';
import { seedWorkflowRuns, upsertWorkflowRun, type WorkflowRunsSlice } from './chat-workflow-runs';
import { sameBackgroundTasks, sameWorktreeOffers } from './snapshot-equality';
import type { ChatThreadState } from './chat-thread-state';

export interface ChatEnvironmentSlice {
  /**
   * Latest chat metadata from the daemon's `chat.updated` broadcast — model,
   * planMode, permissionMode, effort, features, etc. Null until the first
   * `chat.updated` arrives. The composer config toolbar reads this so its
   * controls stay in sync when the daemon changes them on its own (e.g. the
   * agent exiting plan mode), instead of a stale one-shot REST snapshot.
   */
  readonly chatConfig: Chat | null;
  /**
   * Live background work (agents / bg bash / workflows) keyed by task id — fed
   * by `background_task.*` events, resynced from `chat.updated`'s
   * `backgroundActivity` snapshot. Drives the session panel's Background
   * Activity section and its rail badge.
   */
  readonly backgroundTasks: Readonly<Record<string, BackgroundActivityTask>>;
  /**
   * Claude CLI workflow runs keyed by the CLI task id — fed by
   * `claude_workflow.run.updated` and re-seeded from a dedicated REST read,
   * which is what survives a reload of a run that finished while the webview
   * was gone.
   */
  readonly workflowRuns: WorkflowRunsSlice;
  /**
   * Worktrees the agent created during this session that the chat is not bound
   * to yet, keyed by canonical worktree path — fed by `worktree.offer.*`.
   * Drives the WorktreeSwitchBanner.
   */
  readonly worktreeOffers: Readonly<Record<string, WorktreeSwitchOffer>>;
  /**
   * An accepted offer whose rebind is in flight. `restarting` until the daemon
   * broadcasts a `chat.updated` carrying the target path, then `settled` — the
   * banner shows the confirmation and clears it after a beat.
   */
  readonly switching: { readonly worktreePath: string; readonly phase: 'restarting' | 'settled' } | null;
}

export type EnvironmentEvent =
  | { type: 'chat.config.updated'; chat: Chat }
  | { type: 'workflow.runs.seeded'; runs: ClaudeWorkflowRun[] }
  | { type: 'workflow.run.updated'; run: ClaudeWorkflowRun }
  | { type: 'background.upsert'; task: BackgroundActivityTask }
  | { type: 'background.ended'; taskId: string }
  | { type: 'background.snapshot'; tasks: BackgroundActivityTask[] }
  | { type: 'worktree.offer.added'; offer: WorktreeSwitchOffer }
  | { type: 'worktree.offer.removed'; worktreePath: string }
  | { type: 'worktree.offer.snapshot'; offers: WorktreeSwitchOffer[] }
  | { type: 'worktree.switch.started'; worktreePath: string }
  | { type: 'worktree.switch.failed' }
  | { type: 'worktree.switch.cleared' };

export function createEnvironmentSlice(): ChatEnvironmentSlice {
  return {
    chatConfig: null,
    backgroundTasks: {} as Readonly<Record<string, BackgroundActivityTask>>,
    workflowRuns: {} as WorkflowRunsSlice,
    worktreeOffers: {} as Readonly<Record<string, WorktreeSwitchOffer>>,
    switching: null,
  };
}

/**
 * The chat row's persisted CLI-reported context usage (daemon persists it from
 * `get_context_usage` after each turn), mapped to the contextUsage slice shape.
 * Null when the chat has never reported (legacy rows, codex).
 */
function persistedContextUsage(chat: Chat | null): ChatThreadState['contextUsage'] {
  if (chat == null) return null;
  const { lastContextTotalTokens: total, lastContextMaxTokens: max } = chat;
  if (total == null || max == null || max <= 0) return null;
  return { percentage: (total / max) * 100, totalTokens: total, maxTokens: max };
}

/** True when every composer-toolbar field of two chats is equal (ignores cost/token/updatedAt churn). */
function sameComposerConfig(a: Chat | null, b: Chat): boolean {
  return (
    a !== null &&
    a.adapterId === b.adapterId &&
    a.model === b.model &&
    a.permissionMode === b.permissionMode &&
    a.planMode === b.planMode &&
    a.effort === b.effort &&
    a.fast === b.fast &&
    a.ultracode === b.ultracode &&
    a.adaptiveThinking === b.adaptiveThinking &&
    a.worktreeMissing === b.worktreeMissing &&
    a.directoryMissing === b.directoryMissing &&
    a.missingDirectoryPath === b.missingDirectoryPath &&
    a.transcriptMissing === b.transcriptMissing &&
    a.worktreePath === b.worktreePath &&
    a.branchName === b.branchName
  );
}

/**
 * The daemon's `chat.updated` carrying the target path is the only confirmation
 * that an accepted switch rebound the chat, so the settle is derived here rather
 * than optimistically on accept.
 */
function nextSwitching(state: ChatThreadState, chat: Chat): ChatThreadState['switching'] {
  const { switching } = state;
  if (switching === null || switching.phase === 'settled') return switching;
  if (chat.worktreePath !== switching.worktreePath) return switching;
  return { worktreePath: switching.worktreePath, phase: 'settled' };
}

export function reduceEnvironmentEvent(state: ChatThreadState, event: EnvironmentEvent): ChatThreadState {
  switch (event.type) {
    case 'chat.config.updated': {
      // chat.updated also fires for cost/token/updatedAt churn during a run.
      // Only adopt a new identity when a composer-relevant field actually changed,
      // so the toolbar doesn't re-render on every broadcast. The persisted
      // context totals are adopted separately: they keep the meter truthful on
      // controller seed and after turns completed while this chat was dormant
      // (usage_update only reaches attached facade sessions; chat.updated is ungated).
      const persisted = persistedContextUsage(event.chat);
      const sameUsage =
        persisted == null ||
        (state.contextUsage != null &&
          state.contextUsage.totalTokens === persisted.totalTokens &&
          state.contextUsage.maxTokens === persisted.maxTokens);
      const sameConfig = sameComposerConfig(state.chatConfig, event.chat);
      const switching = nextSwitching(state, event.chat);
      if (sameConfig && sameUsage && switching === state.switching) return state;
      return {
        ...state,
        chatConfig: sameConfig ? state.chatConfig : event.chat,
        contextUsage: sameUsage ? state.contextUsage : persisted,
        switching,
      };
    }

    case 'workflow.runs.seeded':
      return { ...state, workflowRuns: seedWorkflowRuns(event.runs) };

    case 'workflow.run.updated': {
      const workflowRuns = upsertWorkflowRun(state.workflowRuns, event.run);
      return workflowRuns === state.workflowRuns ? state : { ...state, workflowRuns };
    }

    case 'background.upsert':
      return {
        ...state,
        backgroundTasks: { ...state.backgroundTasks, [event.task.id]: event.task },
      };

    case 'background.ended': {
      if (!(event.taskId in state.backgroundTasks)) return state;
      const backgroundTasks = { ...state.backgroundTasks };
      delete backgroundTasks[event.taskId];
      return { ...state, backgroundTasks };
    }

    case 'background.snapshot': {
      // chat.updated fires on every turn boundary — bail identity-stable when
      // the snapshot matches so the composer doesn't re-render on churn.
      if (sameBackgroundTasks(state.backgroundTasks, event.tasks)) return state;
      const backgroundTasks: Record<string, BackgroundActivityTask> = {};
      for (const task of event.tasks) backgroundTasks[task.id] = task;
      return { ...state, backgroundTasks };
    }

    case 'worktree.offer.added':
      return {
        ...state,
        worktreeOffers: { ...state.worktreeOffers, [event.offer.worktreePath]: event.offer },
      };

    case 'worktree.offer.removed': {
      if (!(event.worktreePath in state.worktreeOffers)) return state;
      const worktreeOffers = { ...state.worktreeOffers };
      delete worktreeOffers[event.worktreePath];
      return { ...state, worktreeOffers };
    }

    case 'worktree.offer.snapshot': {
      // Resent on every subscribe/reconnect — bail identity-stable when nothing
      // moved so the composer doesn't re-render on reconnect churn.
      if (sameWorktreeOffers(state.worktreeOffers, event.offers)) return state;
      const worktreeOffers: Record<string, WorktreeSwitchOffer> = {};
      for (const offer of event.offers) worktreeOffers[offer.worktreePath] = offer;
      return { ...state, worktreeOffers };
    }

    case 'worktree.switch.started':
      return { ...state, switching: { worktreePath: event.worktreePath, phase: 'restarting' } };

    case 'worktree.switch.failed':
    case 'worktree.switch.cleared':
      return state.switching === null ? state : { ...state, switching: null };
  }
}
