/**
 * The first message of a draft, kept until the daemon has accepted it: what was
 * submitted, for the user to restore when creating the session or sending its
 * first prompt fails. In memory only: a reload loses it, like the composer.
 *
 * An entry belongs to a thread, not to a composer: the draft's id, then the
 * session's once the draft became one. Every composer of that thread shows it.
 */
import type { Attachment, CompleteAttachment } from '@assistant-ui/react';
import { create } from 'zustand';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { isDraftSessionId } from '@/store/layout-persist';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';
import { sendFailureReason, sendRefusal } from '../../controller/describe-send-error';
import type { DraftItem } from '../draft-content/draft-content-store';
import type { Composition } from '../segments/segment-model';

/** A composer's content as it was submitted. Never changed after. */
export interface SubmittedDraft {
  readonly text: string;
  readonly composition?: Composition;
  readonly items: readonly DraftItem[];
  readonly attachments: readonly Attachment[];
  readonly references: Readonly<Record<string, string>>;
}

export interface UnsentMessage {
  readonly id: string;
  readonly threadId: string;
  readonly daemonId: string;
  readonly draft: SubmittedDraft;
  /** The draft's setup when it was submitted: where its captures and annotations belong. */
  readonly setup?: DraftCfg;
  /** What went with the prompt, for a Retry to send again. */
  readonly sent: readonly CompleteAttachment[];
  /** The prompt was handed to the connection: without a refusal, the agent may have it. */
  readonly prompted: boolean;
  /** Undefined while it is on its way. */
  readonly failure?: { readonly reason: string; readonly delivery: 'none' | 'unknown' };
}

interface UnsentState {
  entries: readonly UnsentMessage[];
}

export const useUnsentMessages = create<UnsentState>(() => ({ entries: [] }));

/** Where a draft's entries wait while no draft of their daemon is open. */
const NO_DRAFT = '__LOCALID_closed';

function update(id: string | undefined, change: (entry: UnsentMessage) => UnsentMessage): void {
  if (id === undefined) return;
  useUnsentMessages.setState((s) => ({ entries: s.entries.map((entry) => (entry.id === id ? change(entry) : entry)) }));
}

function keep(test: (entry: UnsentMessage) => boolean): void {
  useUnsentMessages.setState((s) => (s.entries.every(test) ? s : { entries: s.entries.filter(test) }));
}

export function holdUnsent(entry: Pick<UnsentMessage, 'threadId' | 'draft' | 'setup' | 'sent'>): string {
  const id = crypto.randomUUID();
  useUnsentMessages.setState((s) => ({
    entries: [...s.entries, { ...entry, id, daemonId: getActiveDaemon().id, prompted: false }],
  }));
  return id;
}

export function getUnsent(id: string | undefined): UnsentMessage | undefined {
  return id === undefined ? undefined : useUnsentMessages.getState().entries.find((entry) => entry.id === id);
}

/** Whether a thread has an entry, on its way or failed. */
export function hasUnsent(threadId: string): boolean {
  const daemonId = getActiveDaemon().id;
  return useUnsentMessages.getState().entries.some((e) => e.threadId === threadId && e.daemonId === daemonId);
}

/** The draft became a session. */
export function moveUnsent(id: string | undefined, threadId: string): void {
  update(id, (entry) => ({ ...entry, threadId }));
}

/** The prompt is about to be written. */
export function markPrompted(id: string | undefined): void {
  update(id, (entry) => ({ ...entry, prompted: true }));
}

/** A Retry is on its way: nothing to restore until it settles. */
export function markRetrying(id: string | undefined): void {
  update(id, ({ failure: _failure, ...entry }) => ({ ...entry, prompted: false }));
}

/** Accepted, restored or discarded. */
export function dropUnsent(id: string | undefined): void {
  keep((entry) => entry.id !== id);
}

export function failUnsent(id: string | undefined, error: unknown): void {
  update(id, (entry) => ({
    ...entry,
    failure: {
      reason: sendFailureReason(error),
      delivery: entry.prompted && sendRefusal(error) === undefined ? 'unknown' : 'none',
    },
  }));
}

/** The draft or the session is gone. */
export function dropUnsentOf(threadId: string): void {
  const daemonId = getActiveDaemon().id;
  keep((entry) => entry.threadId !== threadId || entry.daemonId !== daemonId);
}

/** A daemon switch ends every open draft; the ids of the next ones are new. */
export function closeUnsentDrafts(): void {
  useUnsentMessages.setState((s) => ({
    entries: s.entries.map((entry) => (isDraftSessionId(entry.threadId) ? { ...entry, threadId: NO_DRAFT } : entry)),
  }));
}

/** Gives a draft what an earlier draft of this daemon left. */
export function reopenUnsentDrafts(threadId: string): void {
  const daemonId = getActiveDaemon().id;
  const { entries } = useUnsentMessages.getState();
  const waits = (entry: UnsentMessage) => entry.threadId === NO_DRAFT && entry.daemonId === daemonId;
  if (!isDraftSessionId(threadId) || !entries.some(waits)) return;
  useUnsentMessages.setState({ entries: entries.map((entry) => (waits(entry) ? { ...entry, threadId } : entry)) });
}

// ── The message's link to its entry ──────────────────────────────────────────

const META_KEY = 'mainframeUnsentId';

export function unsentMetadata(id: string): { custom: Record<string, unknown> } {
  return { custom: { [META_KEY]: id } };
}

export function unsentIdOf(message: { metadata?: { custom?: Record<string, unknown> } }): string | undefined {
  const id = message.metadata?.custom?.[META_KEY];
  return typeof id === 'string' ? id : undefined;
}
