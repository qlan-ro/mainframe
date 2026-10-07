/**
 * toTabEntry — one thread-list entry (or a custom-less draft) → SessionTabEntry.
 * Extracted out of `SessionTabs.tsx` to stay under the file's line budget.
 */
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import type { SessionCustom, ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { forkAvailability, type ForkAvailability } from '@/features/sessions/view-model/fork-availability';
import { isSideChat } from '@/features/side-chat/side-chat-ids';
import type { SessionTabEntry } from './SessionTabPill';

/**
 * A tab with no thread-list entry yet (a brand-new `__LOCALID_*` draft) has no
 * `SessionCustom` at all, so there is no capability to check — it reads as
 * "Nothing to fork yet" directly rather than through the adapter-capability
 * check first (which would otherwise misreport a blank adapter name).
 */
function tabForkAvailability(
  custom: SessionCustom | undefined,
  adaptersById: Readonly<Record<string, AdapterInfo>>,
): ForkAvailability {
  if (custom == null) return { enabled: false, reason: 'Nothing to fork yet' };
  const adapter = adaptersById[custom.adapterId];
  return forkAvailability({
    capabilityFork: adapter?.capabilities.fork ?? false,
    capabilityReason: adapter?.forkUnavailableReason,
    adapterName: adapter?.name ?? custom.adapterId,
    temporary: custom.temporary,
    noProject: custom.noProject,
    claudeSessionId: custom.claudeSessionId,
    transcriptMissing: custom.transcriptMissing,
    directoryMissing: custom.directoryMissing ?? false,
    isRunning: custom.isRunning ?? false,
    hasPending: custom.hasPending,
  });
}

/**
 * A draft has no chat id yet to attach a side chat to; a side chat itself
 * can't get another (no nesting); an archived tab (reachable only via a
 * lingering pin) can't either — the daemon 409s all three (todo #344).
 */
function tabCanOpenSideChat(custom: SessionCustom | undefined): boolean {
  if (custom == null || custom.status === 'archived') return false;
  return !isSideChat(custom);
}

export function toTabEntry(
  id: string,
  items: readonly ThreadListEntry[],
  projectNames: ReadonlyMap<string, string>,
  activeId: string | null,
  preview: boolean,
  adaptersById: Readonly<Record<string, AdapterInfo>>,
): SessionTabEntry {
  const entry = items.find((t) => t.id === id);
  const isDraft = entry == null || entry.status === 'new';
  const custom = entry?.custom as SessionCustom | undefined;
  const projectId = custom?.projectId;
  return {
    id,
    title: entry?.title ?? (isDraft ? 'New Session' : 'Untitled'),
    projectId,
    projectName: projectId != null ? projectNames.get(projectId) : undefined,
    adapterId: custom?.adapterId,
    active: id === activeId,
    preview,
    forkAvailability: tabForkAvailability(custom, adaptersById),
    // The chat's own pending gate OR its side chat's (todo #344) or a
    // delegated child's — NOT the `hasPending` fed to tabForkAvailability
    // above, which stays the chat's own value so a waiting side chat never
    // blocks forking the parent.
    hasPending:
      (custom?.hasPending ?? false) || (custom?.sideChatWaiting ?? false) || (custom?.delegatedWaiting ?? false),
    canOpenSideChat: tabCanOpenSideChat(custom),
  };
}
