import type { Chat, QueuedMessageRef } from './chat.js';
import type { AdapterProcess } from './adapter.js';
import type { UIZone } from './plugin.js';
import type { LaunchProcessStatus } from './launch.js';
import type { AutomationRunSummary, AutomationInteractionSummary } from './automation.js';
import type { WorktreeSwitchOffer, WorktreeOfferOutcome } from './worktree-offer.js';

export type ChatNotificationKind = 'task_complete' | 'session_error' | 'attention_request';

export type DaemonEvent =
  | { type: 'connection.ready'; clientId: string }
  | { type: 'chat.created'; chat: Chat; source?: 'import' }
  | { type: 'chat.updated'; chat: Chat; reason?: 'completed' | 'error' | 'interrupted' }
  | { type: 'chat.ended'; chatId: string }
  | { type: 'process.started'; chatId: string; process: AdapterProcess }
  | { type: 'process.ready'; processId: string; claudeSessionId: string }
  | { type: 'process.stopped'; processId: string }
  | { type: 'messages.cleared'; chatId: string }
  | { type: 'context.updated'; chatId: string; filePaths?: string[] }
  | { type: 'error'; chatId?: string; error: string }
  | {
      type: 'plugin.panel.registered';
      pluginId: string;
      panelId: string;
      zone: UIZone;
      label: string;
      icon?: string;
    }
  | { type: 'plugin.panel.unregistered'; pluginId: string; panelId?: string }
  | {
      type: 'plugin.action.registered';
      pluginId: string;
      actionId: string;
      label: string;
      shortcut: string;
      icon?: string;
    }
  | { type: 'plugin.action.unregistered'; pluginId: string; actionId: string }
  | { type: 'plugin.notification'; pluginId: string; title: string; body: string; level?: string }
  | {
      type: 'launch.output';
      projectId: string;
      effectivePath: string;
      name: string;
      data: string;
      stream: 'stdout' | 'stderr';
    }
  | { type: 'launch.status'; projectId: string; effectivePath: string; name: string; status: LaunchProcessStatus }
  | { type: 'launch.tunnel'; projectId: string; effectivePath: string; name: string; url: string }
  | { type: 'launch.tunnel.failed'; projectId: string; effectivePath: string; name: string; error: string }
  | { type: 'launch.port.timeout'; projectId: string; effectivePath: string; name: string; port: number }
  | { type: 'launch.scopeReleased'; projectId: string; effectivePath: string }
  | { type: 'sessions.external.count'; projectId: string; count: number }
  | { type: 'message.queued'; chatId: string; ref: QueuedMessageRef }
  | { type: 'message.queued.processed'; chatId: string; uuid: string }
  | { type: 'message.queued.cancelled'; chatId: string; uuid: string }
  | { type: 'message.queued.cleared'; chatId: string }
  | { type: 'message.queued.snapshot'; chatId: string; refs: QueuedMessageRef[] }
  | {
      type: 'chat.notification';
      chatId: string;
      title: string;
      body: string;
      level: 'success' | 'error';
      kind?: ChatNotificationKind;
    }
  | { type: 'chat.compacting'; chatId: string }
  | { type: 'chat.compactDone'; chatId: string }
  | {
      type: 'adapter.models.updated';
      adapterId: string;
      models: import('./adapter.js').AdapterModel[];
      modelsRevision: number;
      /** The probe's install verdict. Optional only for daemons older than the field. */
      installed?: boolean;
    }
  | {
      type: 'provider.quota.updated';
      adapterId: string;
      quota: import('./adapter.js').ProviderQuota;
    }
  | { type: 'todos.updated'; chatId: string; todos: import('./chat.js').TodoItem[] }
  | { type: 'chat.prDetected'; chatId: string; pr: import('./adapter.js').DetectedPr }
  | { type: 'worktree.offer.raised'; chatId: string; offer: WorktreeSwitchOffer }
  | { type: 'worktree.offer.resolved'; chatId: string; worktreePath: string; outcome: WorktreeOfferOutcome }
  | { type: 'worktree.offer.snapshot'; chatId: string; offers: WorktreeSwitchOffer[] }
  | { type: 'chat.trustRequired'; chatId: string; projectPath: string }
  | {
      type: 'tunnel:status';
      state: 'starting' | 'ready' | 'dns_verified' | 'error' | 'stopped';
      label: string;
      url?: string;
      dnsVerified?: boolean;
      error?: string;
    }
  | { type: 'file:changed'; path: string }
  | { type: 'subscribe:file:ack'; requestedPath: string; resolvedPath: string }
  | { type: 'subscribe:ack'; chatId: string }
  | { type: 'background_task.started'; chatId: string; task: import('./background-task.js').BackgroundTask }
  | { type: 'background_task.updated'; chatId: string; task: import('./background-task.js').BackgroundTask }
  | { type: 'background_task.ended'; chatId: string; task: import('./background-task.js').BackgroundTask }
  // Distinct from 'automation.run.updated' below — this carries a Claude CLI /workflows run, not an Automations run.
  | { type: 'claude_workflow.run.updated'; chatId: string; run: import('./claude-workflow.js').ClaudeWorkflowRun }
  | { type: 'automation.run.updated'; run: AutomationRunSummary }
  | { type: 'automation.interaction.created'; interaction: AutomationInteractionSummary }
  | { type: 'automation.interaction.resolved'; interactionId: string; runId: string }
  | {
      type: 'automation.completed';
      automationId: string;
      automationName: string;
      runId: string;
      status: 'succeeded' | 'failed';
      result: string;
    }
  | {
      type: 'automation.notification';
      runId: string;
      automationId: string;
      title: string;
      body: string;
      links: { runId: string; chatIds: string[] };
    }
  // A standalone, run-less notification (POST /api/notifications) — e.g. a
  // todo-lane stage update from lane_apply.py, which runs outside any
  // automation run and so has neither a runId nor an automationId.
  | {
      type: 'notification.created';
      title: string;
      body: string;
      links?: { chatIds: string[] };
    };

export type ClientEvent =
  | { type: 'subscribe'; chatId: string }
  | { type: 'unsubscribe'; chatId: string }
  | { type: 'subscribe:file'; path: string; projectId?: string; chatId?: string }
  | { type: 'unsubscribe:file'; path: string; projectId?: string; chatId?: string };
