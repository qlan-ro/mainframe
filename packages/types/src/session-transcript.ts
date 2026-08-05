/**
 * Why a session is not offerable in the `@` mention picker (todo #240).
 * `never-started` = chat has no CLI session id yet; `transcript-missing` = the
 * adapter knows the expected path but no file exists there.
 */
export type TranscriptUnavailableReason = 'never-started' | 'transcript-missing';

/**
 * Per-chat transcript resolution. `unknown` means the adapter cannot
 * determine the transcript's location at all (for example: no adapter
 * override exists yet) — callers must treat it the same as "not offerable",
 * never confuse it with `unavailable`, whose reason is meaningful.
 */
export type TranscriptResolution =
  | { chatId: string; state: 'resolved'; path: string }
  | { chatId: string; state: 'unavailable'; reason: TranscriptUnavailableReason }
  | { chatId: string; state: 'unknown' };

export interface ResolveTranscriptsRequest {
  chatIds: string[];
}

export interface ResolveTranscriptsResponse {
  resolutions: TranscriptResolution[];
}
