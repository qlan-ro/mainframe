'use client';

/**
 * The ONE contract for the daemon-derived data we ride on a message.
 *
 * convert-message writes it under `metadata.custom.mainframe`; every consumer
 * reads it through `useMainframeMeta()` — replacing the three divergent
 * metadata shapes + ad-hoc readers the projection used to thread. The reader
 * returns a STABLE reference (the store object, or a frozen empty) so it never
 * trips the useAuiState getSnapshot loop.
 *
 * (Native `metadata.timing` stays a separate top-level field — it is assistant-ui's
 * own shape, not ours.)
 */
import { useAuiState } from '@assistant-ui/react';
import type { CaptureRow } from './parse-captures';
import type { ReviewComment } from './parse-review-comment';

export interface MainframeMessageMeta {
  // assistant turn
  readonly partGroups?: Readonly<Record<string, string>>;
  readonly groupSummaries?: Readonly<Record<string, string>>;
  readonly cost?: number;
  /** Set on an assistant `error` turn → AssistantMessage renders a styled error
   *  block instead of the plain text part (which is kept for a11y/fallback). */
  readonly errorText?: string;
  // user turn
  readonly queued?: boolean;
  readonly cleanText?: string;
  readonly command?: {
    readonly name: string;
    readonly userText?: string;
    readonly source?: 'commands' | (string & {});
  };
  /** Daemon attachment previews (name/kind/sizeBytes) — feeds the file-pill
   *  size subline AND the capture-chip image lookup (kind==='image' names
   *  align positionally with the message's image parts, by daemon construction). */
  readonly attachmentPreviews?: ReadonlyArray<{
    readonly name: string;
    readonly kind: 'image' | 'file';
    readonly sizeBytes?: number;
    readonly mediaType?: string;
  }>;
  /** Sandbox-capture rows parsed from the \0__MF_SANDBOX_CAPTURE__ block. */
  readonly captures?: ReadonlyArray<CaptureRow>;
  /** Code-reference (review-from-editor) — render-only contract; no producer yet. */
  readonly codeRef?: {
    readonly file: string;
    readonly range: { readonly start: number; readonly end?: number };
    readonly code: string;
  };
  /** Diff-review comments parsed from the desktop "Diff of `file`" text shape. */
  readonly reviewComment?: ReviewComment;
  // optimistic pending (written by projectPendingMessage in project-messages.ts)
  readonly pending?: boolean;
  readonly clientId?: string;
  readonly error?: string;
  // system turn
  readonly isCompacted?: boolean;
  readonly skillLoaded?: { readonly skillName: string; readonly path: string; readonly content: string };
}

/** One item in the _TaskProgress synthetic tool args — the app-tauri-local contract. */
export interface TaskProgressItem {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly result: unknown;
  readonly isError?: boolean;
}

/** Typed args for the synthetic tool-call parts (built in the projection, read by the cards). */
export interface TaskProgressArgs {
  readonly items: ReadonlyArray<TaskProgressItem>;
}

const EMPTY_META: MainframeMessageMeta = Object.freeze({});

/** The message's mainframe metadata as one typed, stable object. */
export function useMainframeMeta(): MainframeMessageMeta {
  return useAuiState((s) => {
    const custom = (s as { message: { metadata?: { custom?: { mainframe?: MainframeMessageMeta } } } }).message.metadata
      ?.custom;
    return custom?.mainframe ?? EMPTY_META;
  });
}
