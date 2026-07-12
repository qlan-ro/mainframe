import type { Chat, ChatMessage, QueuedMessageRef } from './chat.js';
import type { AdapterProcess, ControlRequest } from './adapter.js';
import type { UIZone } from './plugin.js';
import type { LaunchProcessStatus } from './launch.js';
import type { AutomationRunSummary, AutomationInteractionSummary } from './automation.js';

export type DaemonEvent =
  | { type: 'connection.ready'; clientId: string }
  | { type: 'chat.created'; chat: Chat; source?: 'import' }
  | { type: 'chat.updated'; chat: Chat; reason?: 'completed' | 'error' | 'interrupted' }
  | { type: 'chat.ended'; chatId: string }
  | { type: 'process.started'; chatId: string; process: AdapterProcess }
  | { type: 'process.ready'; processId: string; claudeSessionId: string }
  | { type: 'process.stopped'; processId: string }
  | { type: 'message.added'; chatId: string; message: ChatMessage }
  | { type: 'message.updated'; chatId: string; message: ChatMessage }
  | { type: 'display.message.added'; chatId: string; message: import('./display.js').DisplayMessage }
  | { type: 'display.message.updated'; chatId: string; message: import('./display.js').DisplayMessage }
  | { type: 'display.messages.set'; chatId: string; messages: import('./display.js').DisplayMessage[] }
  | { type: 'messages.cleared'; chatId: string }
  | { type: 'permission.requested'; chatId: string; request: ControlRequest; notify: boolean }
  | { type: 'permission.resolved'; chatId: string; requestId: string }
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
  | { type: 'chat.notification'; chatId: string; title: string; body: string; level: 'success' | 'error' }
  | { type: 'chat.compacting'; chatId: string }
  | { type: 'chat.compactDone'; chatId: string }
  | { type: 'chat.contextUsage'; chatId: string; percentage: number; totalTokens: number; maxTokens: number }
  | {
      type: 'adapter.models.updated';
      adapterId: string;
      models: import('./adapter.js').AdapterModel[];
      modelsRevision: number;
    }
  | { type: 'todos.updated'; chatId: string; todos: import('./chat.js').TodoItem[] }
  | { type: 'chat.prDetected'; chatId: string; pr: import('./adapter.js').DetectedPr }
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
    };

export type ClientEvent =
  | {
      type: 'message.send';
      chatId: string;
      content: string;
      attachmentIds?: string[];
      metadata?: {
        command?: { name: string; source: string; args?: string };
      };
    }
  | { type: 'permission.respond'; chatId: string; response: import('./adapter.js').ControlResponse }
  | { type: 'subscribe'; chatId: string }
  | { type: 'unsubscribe'; chatId: string }
  | { type: 'subscribe:file'; path: string; projectId?: string; chatId?: string }
  | { type: 'unsubscribe:file'; path: string; projectId?: string; chatId?: string };
