/**
 * toTabEntry — one thread-list entry (or a custom-less draft) → SessionTabEntry.
 * Extracted out of `SessionTabs.tsx` to stay under the file's line budget.
 */
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import type { SessionCustom, ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { forkAvailability, type ForkAvailability } from '@/features/sessions/view-model/fork-availability';
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
    adapterName: adapter?.name ?? custom.adapterId,
    claudeSessionId: custom.claudeSessionId,
    transcriptMissing: custom.transcriptMissing,
    directoryMissing: custom.directoryMissing ?? false,
    isRunning: custom.isRunning ?? false,
    hasPending: custom.hasPending,
  });
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
    active: id === activeId,
    preview,
    forkAvailability: tabForkAvailability(custom, adaptersById),
  };
}
