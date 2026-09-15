/**
 * Gates the facade plane's SUBSCRIPTION on whether this chat is the active
 * thread (D2 dormancy, todo #350 T33) — split out of `acp-chat-controller.ts`
 * to keep it under the 300-line cap. `load()`'s config-seed + client bind
 * happen unconditionally; only the subscribe half (session/resume plus
 * listeners) is gated here.
 *
 * Two paths reach the same subscribe, because `load()`'s own activation
 * check only runs inside its in-flight promise: not-yet-`ready` piggybacks
 * on a fresh `load()`; already-`ready` calls `reactivatePlane()` directly,
 * since a repeat `load()` short-circuits without re-running that check.
 */
import type { AcpClientHandle } from './acp-chat-controller';

export interface ChatActivationHost {
  isLocalOnly(): boolean;
  isReady(): boolean;
  getClient(): AcpClientHandle | null;
  load(): Promise<void>;
  reactivatePlane(client: AcpClientHandle): Promise<void>;
  detachPlane(): void;
}

export class ChatActivation {
  private active = false;

  constructor(private readonly host: ChatActivationHost) {}

  get isActive(): boolean {
    return this.active;
  }

  /** Idempotent on a repeat call with the same value. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.ensureFacadeActive();
    else this.host.detachPlane();
  }

  /**
   * Re-checks activation after `setRemoteId` adopts an id — a `__LOCALID_*`
   * thread can be marked active before it has a remote id (nothing to
   * attach to yet), and would otherwise never subscribe once adopted.
   */
  onRemoteIdAdopted(): void {
    this.ensureFacadeActive();
  }

  private ensureFacadeActive(): void {
    if (!this.active || this.host.isLocalOnly()) return;
    if (this.host.isReady()) {
      const client = this.host.getClient();
      if (client) {
        void this.host
          .reactivatePlane(client)
          .catch((err: unknown) => console.warn('[acp-chat] reactivate failed', err));
      }
      return;
    }
    void this.host.load().catch((err: unknown) => console.warn('[acp-chat] activation load failed', err));
  }
}
