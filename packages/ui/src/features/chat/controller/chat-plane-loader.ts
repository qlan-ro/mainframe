/**
 * The controller's load pipeline — REST config seed (which names the adapter
 * profile), shared facade-client connect, and session-plane bind — deduped
 * by a single in-flight promise. Split from `acp-chat-controller.ts` along
 * the lifecycle seam: the controller keeps identity and dispatch; this owns
 * "how a chat becomes loaded".
 *
 * Attach is NOT part of load (D2 dormancy, todo #350 T33): a chat's config
 * loads regardless of whether it's the active thread, but the plane only
 * SUBSCRIBES (session/resume, listeners) when active. `load()` binds the
 * resolved client and, if the host is already active, attaches it too —
 * both inside the SAME deduped promise, so an `await load()` from any
 * caller (mount, a switch-back) sees a fully-settled result either way.
 * `loadState: 'ready'` therefore means "config seeded, client bound" — plus
 * "facade live" only when active; only the active thread renders, so an
 * inactive thread reading `ready` without a live stream is harmless.
 */
import { getChat, getChatWorkflowRuns } from '../../../lib/api/chats';
import type { AcpClientHandle } from './acp-chat-controller';
import type { ChatStateEvent } from './chat-thread-state';

export interface ChatLoaderHost {
  getPort(): number;
  getDaemonId(): string;
  /** A `__LOCALID_*` thread has no daemon chat yet — load is a no-op. */
  isLocalOnly(): boolean;
  isDisposed(): boolean;
  /** loadState already 'ready' — a non-forced load resolves immediately. */
  isReady(): boolean;
  /** Whether this chat is the active thread right now (D2) — gates the attach half of load. */
  isActive(): boolean;
  dispatch(event: ChatStateEvent): void;
  /** Test seam — production resolves the shared per-profile client. */
  resolveClient(profile: string): AcpClientHandle;
  /** Bind the plane to the client — no subscription, no wire traffic. */
  bindPlane(client: AcpClientHandle): void;
  /** Subscribe the plane (session/resume + listeners) — only while active. */
  reactivatePlane(client: AcpClientHandle): Promise<void>;
}

export class ChatPlaneLoader {
  private loadPromise: Promise<void> | null = null;
  private client: AcpClientHandle | null = null;

  constructor(private readonly host: ChatLoaderHost) {}

  /** The last client bound during a successful load — null before the first load resolves. */
  getClient(): AcpClientHandle | null {
    return this.client;
  }

  /** Deduped by loadPromise; `force` re-runs it (extras.retry after a failed load). */
  load(force = false): Promise<void> {
    if (this.host.isLocalOnly()) return Promise.resolve();
    if (this.loadPromise && !force) return this.loadPromise;
    if (!force && this.host.isReady()) return Promise.resolve();

    this.host.dispatch({ type: 'history.loading' });

    const request = this.seedAndBind()
      .then(() => {
        if (this.loadPromise !== request) return;
        this.host.dispatch({ type: 'history.ready' });
      })
      .catch((error: unknown) => {
        if (this.loadPromise !== request) return;
        this.host.dispatch({ type: 'history.failed', error });
      })
      .finally(() => {
        if (this.loadPromise === request) this.loadPromise = null;
      });

    this.loadPromise = request;
    return request;
  }

  private async seedAndBind(): Promise<void> {
    const host = this.host;
    const chat = await getChat(host.getPort(), host.getDaemonId());
    if (host.isDisposed()) return;
    if (chat) {
      host.dispatch({ type: 'chat.config.updated', chat });
      host.dispatch({ type: 'background.snapshot', tasks: chat.backgroundActivity?.tasks ?? [] });
    }
    // Workflow runs have no facade frame family; their disk backfill is a
    // dedicated REST read now that the history payload is no longer fetched.
    void getChatWorkflowRuns(host.getPort(), host.getDaemonId())
      .then((runs) => {
        if (!host.isDisposed()) host.dispatch({ type: 'workflow.runs.seeded', runs });
      })
      .catch((err: unknown) => console.warn('[acp-chat] workflow-runs seed failed', err));

    const profile = chat?.adapterId ?? 'claude';
    const client = host.resolveClient(profile);
    await client.ensureConnected();
    if (host.isDisposed()) return;
    this.client = client;
    host.bindPlane(client);
    if (host.isActive()) await host.reactivatePlane(client);
  }
}
