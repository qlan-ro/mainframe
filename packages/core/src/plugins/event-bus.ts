import { EventEmitter } from 'node:events';
import type {
  PluginEventBus,
  PublicDaemonEventName,
  PublicDaemonEvent,
  ChatEventName,
  ChatEvent,
} from '@mainframe/types';

export const PUBLIC_DAEMON_EVENT_PREFIX = 'plugin:public:';

export function createPluginEventBus(pluginId: string, daemonBus: EventEmitter): PluginEventBus {
  const internalEmitter = new EventEmitter();

  return {
    emit(event: string, payload: unknown): void {
      internalEmitter.emit(`${pluginId}:${event}`, payload);
    },

    on(event: string, handler: (payload: unknown) => void): void {
      internalEmitter.on(`${pluginId}:${event}`, handler);
    },

    onDaemonEvent(event: PublicDaemonEventName, handler: (e: PublicDaemonEvent) => void): void {
      // Only subscribes to the namespaced public channel — never to raw daemon events
      daemonBus.on(`${PUBLIC_DAEMON_EVENT_PREFIX}${event}`, handler);
    },

    onChatEvent<E extends ChatEventName>(event: E, handler: (e: Extract<ChatEvent, { type: E }>) => void): void {
      internalEmitter.on(`${pluginId}:chat:${event}`, handler as (...args: unknown[]) => void);
    },
  };
}

/**
 * Emit a sanitized public daemon event to all plugin buses.
 * Called by ChatManager / ProjectManager — never passes raw message content.
 */
export function emitPublicDaemonEvent(daemonBus: EventEmitter, event: PublicDaemonEvent): void {
  daemonBus.emit(`${PUBLIC_DAEMON_EVENT_PREFIX}${event.type}`, event);
}
