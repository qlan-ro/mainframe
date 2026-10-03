/**
 * Wires one `AcpSessionClientPort`'s notification listeners for
 * `AcpSessionAttachment` — split out once that file crossed 300 lines
 * fixing the independent review's findings. Pure wiring: every listener
 * forwards straight to the host, `fullReplay`, or `replay` the attachment
 * already owns: this module holds no state of its own.
 */
import type { AcpSessionAttachmentHost, AcpSessionClientPort } from './acp-session-attachment-types';
import type { FullReplayRetry } from './acp-full-replay';
import type { ReplayWindowCoordinator } from './acp-replay-coordinator';

export interface AcpSessionListenerDeps {
  getChatId: () => string;
  host: AcpSessionAttachmentHost;
  fullReplay: FullReplayRetry;
  replay: ReplayWindowCoordinator;
  /** `AcpSessionAttachment.syncConnectionGeneration()` — called before routing a frame to this chat (re-review LOW). */
  syncConnectionGeneration: () => void;
  /** True while a resume round trip or any replay window is in flight — `_mainframe.dev/cursor` (todo #377) is ignored while this holds, so it never races a reply's own `commitReplyCursor`. */
  isResumeOrReplayPending: () => boolean;
}

/**
 * Registers every listener this session cares about on `client` and returns
 * their unsubscribe functions (including `onReplayComplete`'s, which is
 * optional on the port — a daemon that predates the capability simply never
 * calls back, so nothing is pushed for it).
 */
export function wireAcpSessionListeners(client: AcpSessionClientPort, deps: AcpSessionListenerDeps): Array<() => void> {
  const { getChatId: chatId, host, fullReplay, replay, syncConnectionGeneration, isResumeOrReplayPending } = deps;
  const unsubscribe: Array<() => void> = [
    client.onSessionUpdate((sessionId, update) => {
      if (sessionId !== chatId()) return;
      // Reconcile a reconnect this attachment's own gap hasn't caught up to
      // YET — before this frame can land on a stale window's staging
      // (re-review LOW). A no-op once already reconciled.
      syncConnectionGeneration();
      host.onSessionUpdate(update);
    }),
    client.onPermissionRequest((id, request) => {
      if (request.sessionId === chatId()) host.onPermissionRequest(id, request);
    }),
    client.onGateResolved((sessionId, requestId) => {
      if (sessionId === chatId()) host.onGateResolvedForSession(requestId);
    }),
    client.onCompaction((sessionId, phase) => {
      if (sessionId !== chatId()) return;
      host.dispatch({ type: phase === 'started' ? 'compact.started' : 'compact.done' });
    }),
    client.onTranscriptCleared((sessionId) => {
      if (sessionId !== chatId()) return;
      // The server wiped the transcript (plan-mode clear-context): drop the
      // local projection and re-replay so tool-call items drop too. The
      // cursor and accumulator go NOW, not in the deferred reattach — a
      // detach before that runs would swallow it, and a live update in the
      // meantime would re-render items the server has already dropped.
      // Only the round-trip is deferred (and, once staged replay is
      // supported, builds off-screen before it pops back in).
      host.dispatch({ type: 'transcript.cleared' });
      host.resetSettledCursor();
      host.clearDurableCursor();
      host.resetAccumulator();
      fullReplay.requestWipe();
    }),
    client.onQueueState((sessionId, refs) => {
      if (sessionId !== chatId()) return;
      // Always a full snapshot (never a delta) — the reducer replaces the
      // queued set wholesale, so stale turns cannot survive a reconnect.
      host.dispatch({ type: 'queued.snapshot', refs });
    }),
    client.onResync((sessionId) => {
      if (sessionId !== chatId()) return;
      // Cache eviction, NOT a wipe (spec: distinct from transcript_cleared)
      // — re-replay without blanking the reducer's transcript first, or the
      // thread flashes empty mid-conversation. Also invalidates the durable
      // revision cursor (todo #377) — the re-replay's own reply seeds a fresh one.
      host.clearDurableCursor();
      fullReplay.requestResync();
    }),
  ];

  const unsubscribeReplayComplete = client.onReplayComplete?.((sessionId, aborted) => {
    if (sessionId === chatId()) replay.handleReplayComplete(aborted);
  });
  if (unsubscribeReplayComplete) unsubscribe.push(unsubscribeReplayComplete);

  // `_mainframe.dev/cursor` (todo #377) — ignored while a replay window or
  // resume is in flight, so it never races a reply's own `commitReplyCursor`
  // (the attachment's own gate; the tracker enforces epoch/revision ordering).
  const unsubscribeCursor = client.onCursor?.((sessionId, cursor) => {
    if (sessionId !== chatId()) return;
    if (isResumeOrReplayPending()) return;
    host.advanceCursorFromNotification(cursor);
  });
  if (unsubscribeCursor) unsubscribe.push(unsubscribeCursor);

  return unsubscribe;
}
