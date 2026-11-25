/** Puts a submitted draft back into a composer: as it was when the composer is empty, before what is there otherwise. */
import type { Attachment, CreateAttachment } from '@assistant-ui/react';
import { mfToast } from '@/lib/toast';
import { nextFreeLabel } from '../../session-references/reference-label';
import { findSessionMentions } from '../../session-references/session-mention';
import { useDraftContent } from '../draft-content/draft-content-store';
import { readLiveComposerState, type LiveReadableComposer } from '../read-live-composer-state';
import { mintSegmentId, type Composition, type Segment } from '../segments/segment-model';
import { useComposerSegments } from '../segments/segment-store';
import { useSessionReferences } from '../sessions/session-reference-store';
import type { SubmittedDraft } from './unsent-store';

export type DraftComposer = LiveReadableComposer<{ text: string }> & {
  setText: (text: string) => void;
  addAttachment: (attachment: CreateAttachment | File) => Promise<void>;
};

type Rename = (text: string) => string;

/** A mention keeps the session it names: where the composer now uses its label for another, it takes a new one. */
function mergeReferences(threadId: string, restored: SubmittedDraft['references']): Rename {
  const current = useSessionReferences.getState().byThread[threadId] ?? {};
  const renamed = new Map<string, string>();
  const merged = { ...current };
  for (const [label, path] of Object.entries(restored)) {
    const taken = merged[label] !== undefined && merged[label] !== path;
    const free = taken ? nextFreeLabel(label, new Set([...Object.keys(merged), ...Object.keys(restored)])) : label;
    if (free !== label) renamed.set(label, free);
    merged[free] = path;
  }
  useSessionReferences.setState((s) => ({ byThread: { ...s.byThread, [threadId]: merged } }));
  return (text) => {
    let out = '';
    let last = 0;
    for (const { start, end, label } of findSessionMentions(text, Object.keys(restored))) {
      out += `${text.slice(last, start)}@${renamed.get(label) ?? label}`;
      last = end;
    }
    return out + text.slice(last);
  };
}

/** The restored composition as one that can stand before another: its live part committed. */
function committed({ committed: before, liveQuote }: Composition, text: string): Segment[] {
  if (!liveQuote && text.trim() === '') return before;
  return [
    ...before,
    { id: liveQuote?.id ?? mintSegmentId(), quote: liveQuote?.text ?? null, source: liveQuote?.source, text },
  ];
}

export function addAttachments(composer: DraftComposer, attachments: readonly Attachment[]): void {
  for (const attachment of attachments) {
    const input = attachment.file ?? { ...attachment, content: attachment.content ?? [] };
    composer.addAttachment(input).catch((error: unknown) => {
      console.warn('[composer] could not restore an attachment', error);
      mfToast.error(`Could not restore ${attachment.name}`);
    });
  }
}

export function restoreDraft(threadId: string, composer: DraftComposer, draft: SubmittedDraft): void {
  const rename = mergeReferences(threadId, draft.references);
  const { committed: before = [], liveQuote = null } = draft.composition ?? {};
  const restored: Composition = { committed: before.map((s) => ({ ...s, text: rename(s.text) })), liveQuote };
  const text = rename(draft.text);

  const typed = readLiveComposerState(composer).text;
  const here = useComposerSegments.getState().byThread[threadId];
  const quoted = here != null && (here.committed.length > 0 || here.liveQuote != null);
  const composition = quoted
    ? { committed: [...committed(restored, text), ...here.committed], liveQuote: here.liveQuote }
    : restored;
  useComposerSegments.setState((s) => ({ byThread: { ...s.byThread, [threadId]: composition } }));
  if (!quoted) composer.setText([text, typed].filter((part) => part !== '').join('\n\n'));

  useDraftContent.getState().restore(threadId, draft.items);
  addAttachments(composer, draft.attachments);
}
