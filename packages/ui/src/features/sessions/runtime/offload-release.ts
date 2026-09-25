/**
 * OffloadRelease — renderer half of the idle whole-chat offload (#178).
 *
 * On `chat.offloaded`, releases the chat's controller and thread subtree
 * UNLESS the chat is on screen (main thread or a zones-pair member), in which
 * case the release is deferred until a later screen change makes it eligible
 * (see `recheck`). Mirrors SessionListRouter's DI'd-class shape so the class
 * is testable with no React or assistant-ui runtime.
 *
 * Alias resolution (plan "Renderer" section): a chat created this app session
 * has TWO live thread items — the orphaned `__LOCALID_*` draft (`remoteId` =
 * chatId) and the canonical remote item (`id` = chatId) — both mapped to one
 * controller by `chatControllerRegistry.adopt`. Checking only one item is
 * wrong in both directions (see the plan's Established facts), so every
 * resolution step below operates on ALL items matching `id` or `remoteId`.
 *
 * Release order matters: every resolved item is detached (each stops its own
 * runtime and unmounts its subtree) BEFORE the controller is disposed once.
 * A surviving subtree's next render would call `getOrCreate` under its own
 * key and put a controller back — see `use-chat-runtime-hook.ts`.
 */
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';

/** The subset of assistant-ui's ThreadListItemState this class reads. */
export interface ThreadItemRef {
  readonly id: string;
  readonly remoteId: string | undefined;
}

export interface OffloadReleaseDeps {
  getThreadItems: () => readonly ThreadItemRef[];
  getMainThreadId: () => string | null;
  getZones: () => readonly [string, string] | null;
  /** Stops the item's runtime and unmounts its subtree (aui `detach()`). */
  detachItem: (id: string) => void;
  /** Drops the controller under every key it's registered at (registry `dispose`). */
  disposeController: (chatId: string) => void;
  /** Marks a thread so its runtime hook stashes the composer draft on unmount. */
  markForStash: (id: string) => void;
}

function resolveItems(items: readonly ThreadItemRef[], chatId: string): ThreadItemRef[] {
  return items.filter((item) => item.id === chatId || item.remoteId === chatId);
}

function isOnScreen(
  item: ThreadItemRef,
  mainThreadId: string | null,
  zones: readonly [string, string] | null,
): boolean {
  if (mainThreadId != null && item.id === mainThreadId) return true;
  return zones != null && zones.includes(item.id);
}

export class OffloadRelease {
  private readonly unsubscribe: () => void;
  private readonly deferred = new Set<string>();
  private disposed = false;

  constructor(
    ws: DaemonWsClient,
    private readonly deps: OffloadReleaseDeps,
  ) {
    this.unsubscribe = ws.onEvent((event) => this.handleEvent(event));
  }

  private handleEvent(event: DaemonEvent): void {
    if (this.disposed || event.type !== 'chat.offloaded') return;
    this.considerRelease(event.chatId);
  }

  private considerRelease(chatId: string): void {
    const items = resolveItems(this.deps.getThreadItems(), chatId);
    const mainThreadId = this.deps.getMainThreadId();
    const zones = this.deps.getZones();
    const onScreen = items.some((item) => isOnScreen(item, mainThreadId, zones));

    if (onScreen) {
      this.deferred.add(chatId);
      return;
    }

    this.deferred.delete(chatId);
    this.release(chatId, items);
  }

  private release(chatId: string, items: readonly ThreadItemRef[]): void {
    for (const item of items) this.deps.markForStash(item.id);
    for (const item of items) this.deps.detachItem(item.id);
    // Once, after every resolved item has detached — a lone dispose() before
    // that would let a surviving subtree recreate a controller (see header).
    this.deps.disposeController(chatId);
  }

  /** Re-check every deferred chat — call whenever the on-screen set changes
   *  (main thread switch or a zones-pair edit). */
  recheck(): void {
    if (this.disposed) return;
    for (const chatId of [...this.deferred]) this.considerRelease(chatId);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }
}

export function createOffloadRelease(ws: DaemonWsClient, deps: OffloadReleaseDeps): OffloadRelease {
  return new OffloadRelease(ws, deps);
}
