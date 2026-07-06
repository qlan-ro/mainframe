/**
 * PermissionReplyTracker — the controller's permission-reply reliability
 * bookkeeping, extracted so the controller stays under the 300-line limit.
 *
 * Owns NO reducer state. It tracks the just-answered tool uses (so a racing
 * subscribe/reconnect restore doesn't resurrect a permission we already
 * answered, #5) and the verify timers (re-read the daemon's pending after a
 * delay; if the same tool use is still pending the reply was dropped on a
 * closed socket, so restore the gate, #2). The host (ChatThreadController)
 * feeds it callbacks: read pending state, dispatch a restored permission, and
 * the disposed flag that gates all async tails.
 */
import type { ControlRequest } from '@qlan-ro/mainframe-types';
import { getPendingPermission } from '../../../lib/api/chats';

// After answering a permission we optimistically drop the gate, but a WS send is
// dropped if the socket is closed. Re-check the daemon's pending after this delay;
// if the same tool use is still pending, the answer was lost — restore the gate.
export const PERMISSION_VERIFY_DELAY_MS = 3000;

export interface PermissionReplyHost {
  readonly port: number;
  /** The daemon chat id at verify time (read lazily — it can flip via setRemoteId). */
  getChatId: () => string;
  /** requestIds the controller already holds — skip a duplicate restore. */
  hasHeldPermission: (requestId: string) => boolean;
  /** Re-seed the gate from a REST-read pending permission whose reply was lost. */
  dispatchPermission: (request: ControlRequest) => void;
  /** True once the controller is disposed — gates all async tails. */
  isDisposed: () => boolean;
}

export class PermissionReplyTracker {
  private readonly verifyTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly recentlyReplied = new Set<string>();

  constructor(private readonly host: PermissionReplyHost) {}

  /** Tool-use ids whose permission reply is still in flight — skip restoring them. */
  get recentlyRepliedToolUseIds(): ReadonlySet<string> {
    return this.recentlyReplied;
  }

  /**
   * Remember we answered this tool use so a racing restore (subscribe/reconnect
   * REST read of the not-yet-cleared pending) doesn't resurrect it, then verify
   * the answer actually landed.
   */
  recordReply(toolUseId: string): void {
    this.recentlyReplied.add(toolUseId);
    this.verifyDelivered(toolUseId);
  }

  dispose(): void {
    for (const timer of this.verifyTimers) clearTimeout(timer);
    this.verifyTimers.clear();
    this.recentlyReplied.clear();
  }

  /**
   * 3s after answering, re-read the daemon's pending permission. If the SAME
   * tool use is still pending, our `permission.respond` was dropped (socket was
   * closed) — restore the gate so the user can retry. Either way the tool use
   * leaves the in-flight set so a genuine later pending can surface again.
   */
  private verifyDelivered(toolUseId: string): void {
    const timer = setTimeout(() => {
      this.verifyTimers.delete(timer);
      if (this.host.isDisposed()) return;
      void getPendingPermission(this.host.port, this.host.getChatId())
        .then((request) => {
          this.recentlyReplied.delete(toolUseId);
          if (this.host.isDisposed() || !request || request.toolUseId !== toolUseId) return;
          if (request.requestId && this.host.hasHeldPermission(request.requestId)) return;
          this.host.dispatchPermission(request);
        })
        .catch((err: unknown) => {
          this.recentlyReplied.delete(toolUseId);
          console.warn('[chat-controller] verify permission delivery failed', err);
        });
    }, PERMISSION_VERIFY_DELAY_MS);
    this.verifyTimers.add(timer);
  }
}
