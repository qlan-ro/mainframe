/**
 * Session-transcript resolution client (todo #240).
 *
 * Batched on purpose: the `@` picker asks about every candidate session at
 * once, so offerability is settled before a row is drawn rather than per
 * keystroke. The daemon owns the adapter-aware lookup — the chat record's
 * stored transcript path is Claude-shaped for every adapter and must never be
 * trusted here.
 */
import type { ResolveTranscriptsResponse, TranscriptResolution } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

export function resolveSessionTranscripts(port: number, chatIds: string[]): Promise<TranscriptResolution[]> {
  return request<ResolveTranscriptsResponse>('POST', `${apiBase(port)}/api/session-transcripts/resolve`, {
    chatIds,
  }).then((r) => r.resolutions);
}
