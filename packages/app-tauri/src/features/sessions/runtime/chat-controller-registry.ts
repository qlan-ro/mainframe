/**
 * Global controller registry — one ChatThreadController per thread id, shared
 * across the whole app (replaces the per-provider map that lived in
 * ChatRuntimeProvider). assistant-ui keeps every visited thread's subtree
 * mounted, so the registry is the keep-warm store: controllers persist until
 * an explicit dispose() (delete/detach), never on plain switchToThread.
 *
 * Keyed by the STABLE thread id (S1): a new thread's id is `__LOCALID_*` for
 * its whole life — initialize only stamps `remoteId` onto the same entry, it
 * never renames the id — so there is no alias map and no rekey. The coordinator
 * sets the controller's daemon id via setRemoteId() after createChat.
 *
 * StrictMode-safe: getOrCreate is idempotent per id, so a double-invoke mount
 * returns the same controller rather than spawning a duplicate.
 */
import { ChatThreadController } from '../../chat/controller/chat-thread-controller';
import { daemonWs } from '../../../lib/daemon/ws-client';

class ChatControllerRegistry {
  private readonly controllers = new Map<string, ChatThreadController>();

  getOrCreate(chatId: string, port: number): ChatThreadController {
    const existing = this.controllers.get(chatId);
    if (existing) return existing;

    const controller = new ChatThreadController(chatId, port, daemonWs);
    this.controllers.set(chatId, controller);
    return controller;
  }

  dispose(chatId: string): void {
    const controller = this.controllers.get(chatId);
    if (!controller) return;
    controller.dispose();
    this.controllers.delete(chatId);
  }
}

export const chatControllerRegistry = new ChatControllerRegistry();
export type { ChatControllerRegistry };
