/**
 * Global controller registry — one AcpChatController per thread id, shared
 * across the whole app. assistant-ui keeps every visited thread's subtree
 * mounted, so the registry is the keep-warm store: controllers persist until
 * an explicit dispose() (delete/detach), never on plain switchToThread.
 *
 * Keyed by the thread id, with the adopted daemon id as a second key for the
 * same controller (`adopt`). aui's own `__LOCALID_*` entry keeps its id for
 * life, but the chat.created reload adds the canonical remote item and the
 * session router switches onto it — a distinct thread id. Without the second
 * key that switch mounts a BLANK controller: the optimistic pending stays
 * stranded on the draft controller and the fresh one can only re-seed from a
 * REST read the daemon answers before it has stored the user message (it stores
 * it after spawning the CLI), so the first message vanishes (#275).
 *
 * StrictMode-safe: getOrCreate is idempotent per id, so a double-invoke mount
 * returns the same controller rather than spawning a duplicate.
 */
import { AcpChatController } from '../../chat/controller/acp-chat-controller';
import { daemonWs } from '../../../lib/daemon/ws-client';

class ChatControllerRegistry {
  private readonly controllers = new Map<string, AcpChatController>();

  getOrCreate(chatId: string, port: number): AcpChatController {
    const existing = this.controllers.get(chatId);
    if (existing) return existing;

    const controller = new AcpChatController(chatId, port, daemonWs);
    this.controllers.set(chatId, controller);
    return controller;
  }

  /**
   * Adopt the daemon chat id for a thread created this session: the controller
   * keeps its draft key AND becomes reachable under the remote id, so the
   * first-send handoff onto the canonical remote item reuses it — pending
   * message, WS subscription and transcript intact.
   */
  adopt(controller: AcpChatController, remoteId: string): void {
    const stale = this.controllers.get(remoteId);
    if (stale && stale !== controller) {
      stale.dispose();
      this.controllers.delete(remoteId);
    }
    controller.setRemoteId(remoteId);
    this.controllers.set(remoteId, controller);
  }

  dispose(chatId: string): void {
    const controller = this.controllers.get(chatId);
    if (!controller) return;
    controller.dispose();
    // Drop the draft key too — an adopted controller is registered under both.
    for (const [id, entry] of this.controllers) {
      if (entry === controller) this.controllers.delete(id);
    }
  }

  disposeAll(): void {
    for (const id of [...this.controllers.keys()]) this.dispose(id);
  }
}

export const chatControllerRegistry = new ChatControllerRegistry();
export type { ChatControllerRegistry };
