import type { Chat, ChatMessage } from './chat.js';
import type { AdapterProcess, ControlRequest } from './adapter.js';
import type { PermissionMode } from './settings.js';

export type DaemonEvent =
  | { type: 'chat.created'; chat: Chat }
  | { type: 'chat.updated'; chat: Chat }
  | { type: 'chat.ended'; chatId: string }
  | { type: 'process.started'; chatId: string; process: AdapterProcess }
  | { type: 'process.ready'; processId: string; claudeSessionId: string }
  | { type: 'process.stopped'; processId: string }
  | { type: 'message.added'; chatId: string; message: ChatMessage }
  | { type: 'messages.cleared'; chatId: string }
  | { type: 'permission.requested'; chatId: string; request: ControlRequest }
  | { type: 'context.updated'; chatId: string }
  | { type: 'error'; chatId?: string; error: string }
  | {
      type: 'plugin.panel.registered';
      pluginId: string;
      panelId: string;
      label: string;
      icon?: string;
      position: string;
      entryPoint: string;
    }
  | { type: 'plugin.panel.unregistered'; pluginId: string; panelId: string }
  | { type: 'plugin.notification'; pluginId: string; title: string; body: string; level?: string };

export type ClientEvent =
  | { type: 'chat.create'; projectId: string; adapterId: string; model?: string; permissionMode?: PermissionMode }
  | { type: 'chat.resume'; chatId: string }
  | { type: 'chat.end'; chatId: string }
  | { type: 'message.send'; chatId: string; content: string; attachmentIds?: string[] }
  | { type: 'permission.respond'; chatId: string; response: import('./adapter.js').ControlResponse }
  | { type: 'chat.updateConfig'; chatId: string; adapterId?: string; model?: string; permissionMode?: PermissionMode }
  | { type: 'chat.interrupt'; chatId: string }
  | { type: 'chat.enableWorktree'; chatId: string }
  | { type: 'chat.disableWorktree'; chatId: string }
  | { type: 'subscribe'; chatId: string }
  | { type: 'unsubscribe'; chatId: string };
