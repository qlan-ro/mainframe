/**
 * What a draft carries that belongs to where it would run: preview captures
 * (those still in the preview's list too), code annotations, and session
 * mentions, whose text stays as text. The prose, the quotes and the files
 * attached from disk belong to the message.
 */
import { useSandboxStore, type Capture } from '@/store/sandbox';
import { useSessionReferences } from '../sessions/session-reference-store';
import { draftItemsOf, useDraftContent, type DraftItem } from './draft-content-store';

export interface BoundContent {
  readonly items: readonly DraftItem[];
  readonly references: Readonly<Record<string, string>>;
  /** Waiting in the preview's list, not in the message yet. */
  readonly waiting: readonly Capture[];
}

export function takeBound(threadId: string): BoundContent {
  const bound = {
    items: draftItemsOf(threadId),
    references: useSessionReferences.getState().byThread[threadId] ?? {},
    waiting: useSandboxStore.getState().captures,
  };
  useDraftContent.getState().clear(threadId);
  useSessionReferences.getState().clear(threadId);
  useSandboxStore.getState().clearCaptures();
  return bound;
}

export function putBound(threadId: string, { items, references, waiting }: BoundContent): void {
  useDraftContent.getState().restore(threadId, items);
  useSessionReferences.setState((s) => ({
    byThread: { ...s.byThread, [threadId]: { ...references, ...s.byThread[threadId] } },
  }));
  useSandboxStore.setState((s) => ({ captures: [...waiting, ...s.captures] }));
}

const count = (n: number, what: string) => (n === 0 ? [] : [`${n} ${what}${n === 1 ? '' : 's'}`]);

/** "2 captures and 1 code note"; empty when there is nothing. */
export function boundSummary({ items, references, waiting }: BoundContent): string {
  const parts = [
    ...count(items.filter(({ kind }) => kind === 'capture').length + waiting.length, 'capture'),
    ...count(items.filter(({ kind }) => kind === 'code').length, 'code note'),
    ...count(Object.keys(references).length, 'session mention'),
  ];
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
