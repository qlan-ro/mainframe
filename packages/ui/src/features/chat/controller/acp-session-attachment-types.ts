/**
 * `AcpSessionAttachment`'s two interfaces — the narrowed client port it
 * needs, and the host callbacks it drives — split out once the attachment
 * crossed 300 lines (D4, plan task U2). See `acp-session-attachment.ts`'s
 * module doc for the staged-replay contract these methods serve.
 */
import type {
  JsonRpcRequestId,
  MainframeCapabilities,
  PromptRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionResponse,
  RevisionCursor,
  SessionUpdate,
} from '@qlan-ro/mainframe-types';
import type {
  CompactionListener,
  CursorListener,
  GateResolvedListener,
  PermissionRequestListener,
  QueueStateListener,
  ReplayCompleteListener,
  ResyncListener,
  SessionUpdateListener,
  TranscriptClearedListener,
} from '../../../lib/daemon/acp-notification-router';
import type { GapListener, ReplayCursor } from '../../../lib/daemon/acp-client';
import type { ReplayStage } from './acp-replay-stage';
import type { ChatStateEvent } from './chat-thread-state';

/** The `AcpFacadeClient` surface the plane needs — narrowed so a test double doesn't reimplement the whole client. */
export interface AcpSessionClientPort {
  onSessionUpdate(listener: SessionUpdateListener): () => void;
  onPermissionRequest(listener: PermissionRequestListener): () => void;
  onGateResolved(listener: GateResolvedListener): () => void;
  onCompaction(listener: CompactionListener): () => void;
  onTranscriptCleared(listener: TranscriptClearedListener): () => void;
  onQueueState(listener: QueueStateListener): () => void;
  onResync(listener: ResyncListener): () => void;
  /** Closes exactly one `session/resume` replay (D4) — absent on a daemon that predates the capability. */
  onReplayComplete?(listener: ReplayCompleteListener): () => void;
  /** Advances the durable revision cursor outside a resume round trip (todo #377) — absent on a daemon that predates the capability. */
  onCursor?(listener: CursorListener): () => void;
  onGap(listener: GapListener): () => void;
  prompt(sessionId: string, text: string, extra?: Pick<PromptRequest, '_meta'>): Promise<PromptResponse>;
  cancel(sessionId: string): void;
  resume(sessionId: string, cwd: string, replayFrom?: ReplayCursor): Promise<ResumeSessionResponse>;
  respondPermission(id: JsonRpcRequestId, response: RequestPermissionResponse): void;
  /** Drop this session's live stream on the daemon (D2 dormancy) — `_mainframe.dev/session_detach`. */
  detach(sessionId: string): void;
  /** The daemon's advertised `_mainframe.dev` capabilities — `null`/absent on a pre-capability daemon (legacy path). */
  readonly mainframeCapabilities?: MainframeCapabilities | null;
  /** Bumped on every new underlying connection (`acp-client.ts`) — distinguishes a reconnect from a live-socket gap on the SAME connection. */
  readonly connectionGeneration: number;
}

export interface AcpSessionAttachmentHost {
  getChatId(): string;
  dispatch(event: ChatStateEvent): void;
  isDisposed(): boolean;
  /** The next `session/resume` cursor for this chat (todo #377) — collapses the revision-vs-item-vs-start choice `reactivate()`/`resumeFromGap()` used to each re-derive inline. */
  nextReplayFrom(capabilities: MainframeCapabilities | null | undefined): ReplayCursor;
  resetSettledCursor(): void;
  /** `needs-replay`, `transcript_cleared`, and a resync each invalidate the durable revision cursor outright (todo #377) — the next full replay's own reply seeds a fresh one via `completeReplay()`. */
  clearDurableCursor(): void;
  /** `_mainframe.dev/cursor` (todo #377) — the tracker itself enforces epoch/revision ordering; call only when no replay window or resume is in flight (the attachment's own gate, not this method's). */
  advanceCursorFromNotification(cursor: RevisionCursor): void;
  /** Legacy path, and the immediate wipe a real `transcript_cleared` does before its reattach. */
  resetAccumulator(): void;
  hasAccumulatedItems(): boolean;
  onSessionUpdate(update: SessionUpdate): void;
  onPermissionRequest(rpcId: JsonRpcRequestId, request: RequestPermissionRequest): void;
  onGateResolvedForSession(requestId: string): void;
  /** A replay window opened — returns that window's own stage: an off-screen accumulator (full) or a placeholder marking the visible accumulator replaying (cursor). */
  beginReplay(opts: { full: boolean }): ReplayStage;
  /** A window's own `replay_complete` arrived with no `aborted` flag — publish (full) or finish (cursor) THAT window's stage, never another window's. */
  completeReplay(stage: ReplayStage): void;
  /** A window's own stage was discarded — a daemon `aborted:true`, or a previously client-aborted window's marker finally arriving. That window's staging (if any) is thrown away; the visible transcript is untouched. */
  discardReplay(stage: ReplayStage): void;
}
