import type { AppendMessage, Attachment, CreateAttachment } from '@assistant-ui/react';
import { useContext, useLayoutEffect, createContext } from 'react';
import { mfToast } from '@/lib/toast';
import { useSideChatScope } from '@/features/side-chat/side-chat-scope';
import { useDraftContent, type DraftItem } from '../draft-content/draft-content-store';
import { readLiveComposerState, type LiveReadableComposer } from '../read-live-composer-state';
import { useSessionReferences } from '../sessions/session-reference-store';
import { useComposerSegments } from './segment-store';
import { mintSegmentId, type Composition } from './segment-model';

type DraftComposer = LiveReadableComposer<{ text: string; attachments: readonly Attachment[] }> & {
  setText: (text: string) => void;
  addAttachment: (attachment: CreateAttachment | File) => Promise<void>;
  clearAttachments: () => Promise<void>;
};

interface DraftSnapshot {
  text: string;
  attachments: readonly Attachment[];
  items: readonly DraftItem[];
  composition?: Composition;
  references: Readonly<Record<string, string>>;
}

type RestoreDraft = (snapshot: DraftSnapshot) => void;
export const ComposerSurface = createContext<'main' | 'tab'>('main');

type DraftLocation = { key: string; restore?: RestoreDraft; returned: DraftSnapshot[]; sends: number };
const locations = new Map<string, DraftLocation>();
const pending = new Map<string, { location: DraftLocation; draft: DraftSnapshot }>();

function restoreDraft(threadId: string, composer: DraftComposer, draft: DraftSnapshot): void {
  const current = readLiveComposerState(composer);
  const segments = useComposerSegments.getState().byThread[threadId];
  if (segments?.committed.length || segments?.liveQuote) {
    const quote = draft.composition?.liveQuote;
    const live =
      quote || draft.text
        ? [{ id: quote?.id ?? mintSegmentId(), quote: quote?.text ?? null, source: quote?.source, text: draft.text }]
        : [];
    useComposerSegments.setState((s) => ({
      byThread: {
        ...s.byThread,
        [threadId]: {
          committed: [...(draft.composition?.committed ?? []), ...live, ...segments.committed],
          liveQuote: segments.liveQuote,
        },
      },
    }));
  } else {
    if (draft.composition)
      useComposerSegments.setState((s) => ({
        byThread: { ...s.byThread, [threadId]: draft.composition! },
      }));
    composer.setText([draft.text, current.text].filter(Boolean).join('\n\n'));
  }
  useDraftContent.getState().restore(threadId, draft.items);
  useSessionReferences.setState((s) => ({
    byThread: { ...s.byThread, [threadId]: { ...draft.references, ...s.byThread[threadId] } },
  }));
  restoreAttachments(composer, draft.attachments, current.attachments);
}

function restoreAttachments(
  composer: DraftComposer,
  submitted: readonly Attachment[],
  current: readonly Attachment[],
): void {
  if (submitted.length === 0) return;
  const sentIds = new Set(submitted.map(({ id }) => id));
  if (current.length) void composer.clearAttachments();
  for (const attachment of [...submitted, ...current.filter(({ id }) => !sentIds.has(id))]) {
    const input = attachment.content?.length
      ? { ...attachment, content: attachment.content }
      : (attachment.file ?? { ...attachment, content: [] });
    void composer.addAttachment(input).catch(() => mfToast.error('Could not restore an attachment'));
  }
}

export function useSubmittedDraftLocation(threadId: string | undefined, daemonId: string, composer: DraftComposer) {
  const sideChat = useSideChatScope();
  const surface = useContext(ComposerSurface);
  const key = threadId == null ? undefined : JSON.stringify([daemonId, threadId, sideChat ? 'side' : surface]);
  useLayoutEffect(() => {
    if (key == null || threadId == null) return;
    const location = locations.get(key) ?? { key, returned: [], sends: 0 };
    locations.set(key, location);
    const restore: RestoreDraft = (draft) => restoreDraft(threadId, composer, draft);
    location.restore = restore;
    for (const draft of location.returned.splice(0)) restore(draft);
    return () => {
      if (location.restore === restore) delete location.restore;
      if (!location.restore && !location.sends && !location.returned.length) locations.delete(key);
    };
  }, [key, threadId, composer]);
  return key;
}

export function holdSubmittedDraft(key: string | undefined, draft: DraftSnapshot): string | undefined {
  const location = key == null ? undefined : locations.get(key);
  if (!location) return undefined;
  const id = crypto.randomUUID();
  location.sends += 1;
  pending.set(id, { location, draft });
  return id;
}

export function settleSubmittedDraft(message: AppendMessage, outcome: 'accepted' | 'failed' = 'accepted'): boolean {
  const id = message.metadata?.custom?.mainframeSubmittedDraft;
  if (typeof id !== 'string') return false;
  const submission = pending.get(id);
  if (!submission) return false;
  pending.delete(id);
  const { location, draft } = submission;
  location.sends -= 1;
  if (outcome === 'failed') {
    if (location.restore) location.restore(draft);
    else location.returned.unshift(draft);
  }
  if (!location.restore && !location.sends && !location.returned.length) locations.delete(location.key);
  return true;
}
