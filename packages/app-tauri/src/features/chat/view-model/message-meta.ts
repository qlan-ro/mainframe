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

export interface MainframeMessageMeta {
  // assistant turn
  readonly partGroups?: Readonly<Record<string, string>>;
  readonly groupSummaries?: Readonly<Record<string, string>>;
  readonly cost?: number;
  // user turn
  readonly queued?: boolean;
  readonly cleanText?: string;
  readonly command?: { readonly name: string; readonly userText?: string; readonly source?: string };
  readonly attachments?: ReadonlyArray<{ readonly name?: string; readonly kind?: string }>;
  readonly attachedFiles?: ReadonlyArray<{ readonly name: string }>;
  // system turn
  readonly isCompacted?: boolean;
  readonly skillLoaded?: { readonly skillName: string; readonly path: string; readonly content: string };
}

/** Typed args for the synthetic tool-call parts (built in the projection, read by the cards). */
export interface SkillLoadedArgs {
  readonly skillName: string;
  readonly path: string;
  readonly content: string;
}
export interface TaskProgressArgs {
  readonly items: ReadonlyArray<{
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly result: unknown;
    readonly isError?: boolean;
  }>;
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
