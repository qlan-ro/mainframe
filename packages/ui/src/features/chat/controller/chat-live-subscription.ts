/**
 * Ref-counted, idempotent side-band (legacy WS) subscription lifecycle —
 * split out of `acp-chat-controller.ts` to keep it under the 300-line cap.
 * No-op for a `__LOCALID_*` thread. The facade plane is gated separately, by
 * `ChatActivation` — the runtime hook's `opts.active` effect drives both.
 */
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import { ChatWsSubscription } from './chat-ws-subscription';
import { routeDaemonEvent } from './chat-event-router';
import type { ChatStateEvent } from './chat-thread-state';

export interface ChatLiveSubscriptionHost {
  isLocalOnly(): boolean;
  isDisposed(): boolean;
  getChatId(): string;
  getPort(): number;
  getWs(): DaemonWsClient;
  dispatch(event: ChatStateEvent): void;
}

export class ChatLiveSubscription {
  private liveRefs = 0;
  private wsSub: ChatWsSubscription | null = null;

  constructor(private readonly host: ChatLiveSubscriptionHost) {}

  subscribe(): () => void {
    if (this.host.isLocalOnly()) return () => {};
    this.liveRefs += 1;
    if (this.liveRefs === 1) {
      this.wsSub = new ChatWsSubscription({
        chatId: this.host.getChatId(),
        port: this.host.getPort(),
        ws: this.host.getWs(),
        onEvent: (event) =>
          routeDaemonEvent(event, {
            getChatId: () => this.host.getChatId(),
            dispatch: (e) => this.host.dispatch(e),
          }),
        isDisposed: () => this.host.isDisposed(),
      });
      this.wsSub.attach();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.liveRefs -= 1;
      if (this.liveRefs === 0) {
        this.wsSub?.detach();
        this.wsSub = null;
      }
    };
  }

  dispose(): void {
    this.wsSub?.detach();
    this.wsSub = null;
  }
}
