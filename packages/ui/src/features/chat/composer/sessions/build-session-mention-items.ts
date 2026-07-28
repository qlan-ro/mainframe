/**
 * buildSessionMentionItems — the pure projection from the thread list to the
 * `@` picker's session rows (todo #240).
 *
 * Offerability is decided by the daemon's resolution alone: only `resolved`
 * sessions become rows, so `never-started` and `transcript-missing` need no
 * second client-side rule. Archived sessions never arrive here — the caller
 * projects through `regularThreadItemsToSessionItems`.
 */
import type { TranscriptResolution } from '@qlan-ro/mainframe-types';
import type { TriggerItem } from '@/components/trigger-engine/types';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { disambiguateLabels, sanitizeReferenceLabel } from '@/features/chat/session-references/reference-label';

export interface SessionMentionCandidate {
  chatId: string;
  title?: string;
  updatedAt: number;
}

/**
 * Sessions eligible to be ASKED about — same rules as the final filter minus
 * the resolution, plus the never-started skip so a chat that cannot possibly
 * resolve never inflates the batch request.
 */
export function sessionResolutionCandidates(args: {
  sessions: readonly SessionItem[];
  projectId: string | null;
  activeChatId: string | null;
}): SessionMentionCandidate[] {
  const { sessions, projectId, activeChatId } = args;
  if (projectId == null) return [];
  return sessions
    .filter(
      (s) =>
        s.remoteId != null &&
        s.remoteId !== activeChatId &&
        s.custom.projectId === projectId &&
        s.custom.claudeSessionId != null,
    )
    .map((s) => ({ chatId: s.remoteId!, title: s.title, updatedAt: s.custom.updatedAt }));
}

export function buildSessionMentionItems(args: {
  sessions: readonly SessionItem[];
  projectId: string | null;
  activeChatId: string | null;
  resolutions: ReadonlyMap<string, TranscriptResolution>;
}): { items: TriggerItem[]; pathByChatId: Map<string, string> } {
  const { sessions, projectId, activeChatId, resolutions } = args;
  if (projectId == null) return { items: [], pathByChatId: new Map() };

  const offerable = sessions
    .filter((s) => s.remoteId != null && s.remoteId !== activeChatId && s.custom.projectId === projectId)
    .filter((s) => resolutions.get(s.remoteId!)?.state === 'resolved')
    .sort((a, b) => b.custom.updatedAt - a.custom.updatedAt || a.remoteId!.localeCompare(b.remoteId!));

  const labels = disambiguateLabels(
    offerable.map((s) => ({ chatId: s.remoteId!, label: sanitizeReferenceLabel(s.title) })),
  );

  const pathByChatId = new Map<string, string>();
  const items: TriggerItem[] = offerable.map((s) => {
    const resolution = resolutions.get(s.remoteId!);
    if (resolution?.state === 'resolved') pathByChatId.set(s.remoteId!, resolution.path);
    return { id: s.remoteId!, type: 'session', label: labels.get(s.remoteId!)! };
  });

  return { items, pathByChatId };
}
