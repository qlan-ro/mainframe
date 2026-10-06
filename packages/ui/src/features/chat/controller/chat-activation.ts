/**
 * Gates the facade plane's SUBSCRIPTION on whether this chat is the active
 * thread or held on screen by a split zone (D2 dormancy, todo #350 T33) — split out of `acp-chat-controller.ts`
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
  /** The runtime hook's flag: this chat is the main thread. */
  private flag = false;
  /** Holds from on-screen views that are not the main thread (split zones). */
  private holds = 0;

  constructor(private readonly host: ChatActivationHost) {}

  /** Active while it is the main thread OR any visible zone holds it. */
  get isActive(): boolean {
    return this.flag || this.holds > 0;
  }

  /** Idempotent on a repeat call with the same value. */
  setActive(active: boolean): void {
    if (this.flag === active) return;
    const before = this.isActive;
    this.flag = active;
    this.apply(before);
  }

  /**
   * Hold the plane attached while a view shows this chat without it being the
   * main thread — a split zone. Without it an unfocused zone never attaches
   * (blank until clicked) and a zone that loses focus stops streaming.
   * Returns an idempotent release.
   */
  hold(): () => void {
    const before = this.isActive;
    this.holds += 1;
    this.apply(before);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const wasActive = this.isActive;
      this.holds -= 1;
      this.apply(wasActive);
    };
  }

  /**
   * Re-checks activation after `setRemoteId` adopts an id — a `__LOCALID_*`
   * thread can be marked active before it has a remote id (nothing to
   * attach to yet), and would otherwise never subscribe once adopted.
   */
  onRemoteIdAdopted(): void {
    this.ensureFacadeActive();
  }

  private apply(before: boolean): void {
    const now = this.isActive;
    if (now === before) return;
    if (now) this.ensureFacadeActive();
    else this.host.detachPlane();
  }

  private ensureFacadeActive(): void {
    if (!this.isActive || this.host.isLocalOnly()) return;
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
