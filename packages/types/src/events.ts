import type { Chat, ChatMessage, QueuedMessageRef } from './chat.js';
import type { AdapterProcess, ControlRequest } from './adapter.js';
import type { PermissionMode } from './settings.js';
import type { UIZone } from './plugin.js';
import type { LaunchProcessStatus } from './launch.js';

export type DaemonEvent =
  | { type: 'chat.created'; chat: Chat; source?: 'import' }
  | { type: 'chat.updated'; chat: Chat; reason?: 'completed' | 'error' | 'interrupted' }
  | { type: 'chat.ended'; chatId: string }
  | { type: 'process.started'; chatId: string; process: AdapterProcess }
  | { type: 'process.ready'; processId: string; claudeSessionId: string }
  | { type: 'process.stopped'; processId: string }
  | { type: 'message.added'; chatId: string; message: ChatMessage }
  | { type: 'display.message.added'; chatId: string; message: import('./display.js').DisplayMessage }
  | { type: 'display.message.updated'; chatId: string; message: import('./display.js').DisplayMessage }
  | { type: 'display.messages.set'; chatId: string; messages: import('./display.js').DisplayMessage[] }
  | { type: 'messages.cleared'; chatId: string }
  | { type: 'permission.requested'; chatId: string; request: ControlRequest }
  | { type: 'permission.resolved'; chatId: string; requestId: string }
  | { type: 'context.updated'; chatId: string; filePaths?: string[] }
  | { type: 'error'; chatId?: string; error: string }
  | {
      type: 'plugin.panel.registered';
      pluginId: string;
      zone: UIZone;
      label: string;
      icon?: string;
    }
  | { type: 'plugin.panel.unregistered'; pluginId: string }
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
  | { type: 'sessions.external.count'; projectId: string; count: number }
  | { type: 'message.queued'; chatId: string; ref: QueuedMessageRef }
  | { type: 'message.queued.processed'; chatId: string; uuid: string }
  | { type: 'message.queued.cancelled'; chatId: string; uuid: string }
  | { type: 'message.queued.cancel_failed'; chatId: string; uuid: string }
  | { type: 'message.queued.cleared'; chatId: string }
  | { type: 'chat.notification'; chatId: string; title: string; body: string; level: 'success' | 'error' }
  | { type: 'chat.compacting'; chatId: string }
  | { type: 'chat.compactDone'; chatId: string }
  | { type: 'chat.contextUsage'; chatId: string; percentage: number; totalTokens: number; maxTokens: number }
  | { type: 'adapter.models.updated'; adapterId: string; models: import('./adapter.js').AdapterModel[] }
  | { type: 'todos.updated'; chatId: string; todos: import('./chat.js').TodoItem[] }
  | { type: 'chat.prDetected'; chatId: string; pr: import('./adapter.js').DetectedPr };

export type ClientEvent =
  | { type: 'chat.create'; projectId: string; adapterId: string; model?: string; permissionMode?: PermissionMode }
  | { type: 'chat.resume'; chatId: string }
  | { type: 'chat.end'; chatId: string }
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
  | { type: 'chat.updateConfig'; chatId: string; adapterId?: string; model?: string; permissionMode?: PermissionMode }
  | { type: 'chat.interrupt'; chatId: string }
  | { type: 'subscribe'; chatId: string }
  | { type: 'unsubscribe'; chatId: string }
  | { type: 'message.queue.edit'; chatId: string; messageId: string; content: string }
  | { type: 'message.queue.cancel'; chatId: string; messageId: string };
