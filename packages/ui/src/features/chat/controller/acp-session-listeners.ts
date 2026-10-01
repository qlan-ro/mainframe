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
}

/**
 * Registers every listener this session cares about on `client` and returns
 * their unsubscribe functions (including `onReplayComplete`'s, which is
 * optional on the port — a daemon that predates the capability simply never
 * calls back, so nothing is pushed for it).
 */
export function wireAcpSessionListeners(client: AcpSessionClientPort, deps: AcpSessionListenerDeps): Array<() => void> {
  const { getChatId: chatId, host, fullReplay, replay } = deps;
  const unsubscribe: Array<() => void> = [
    client.onSessionUpdate((sessionId, update) => {
      if (sessionId === chatId()) host.onSessionUpdate(update);
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
      // thread flashes empty mid-conversation.
      fullReplay.requestResync();
    }),
  ];

  const unsubscribeReplayComplete = client.onReplayComplete?.((sessionId, aborted) => {
    if (sessionId === chatId()) replay.handleReplayComplete(aborted);
  });
  if (unsubscribeReplayComplete) unsubscribe.push(unsubscribeReplayComplete);

  return unsubscribe;
}
