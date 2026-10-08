/**
 * The runtimeHook for useRemoteThreadListRuntime (§3.2).
 *
 * assistant-ui mounts one subtree per alive thread and runs this hook inside
 * each thread's `threadListItem` context — there is NO threadId argument, so it
 * resolves its own chatId from context. It returns synchronously (invariant 2):
 * a suspending/throwing hook leaves switchToThread stuck.
 *
 * - chatId = item.id (S1: stable for life — __LOCALID_* for a new thread until
 *   the controller learns its remote id via setRemoteId; the daemon id for a
 *   pre-existing thread). NEVER item.remoteId — there is no id-flip.
 * - active = this thread is mainThreadId AND it has a daemon chat (remoteId set);
 *   only then does the controller open a live WS sub (D4). A brand-new local
 *   thread with no remoteId is never live.
 *
 * `skipDraftRestore`: this hook's hidden instance is kept warm for every alive
 * thread, regardless of what the chat surface actually renders for it. A chat
 * that is (or is about to become, via a queued `pendingPair`) a split zone's
 * member is displayed through `ChatZone`'s OWN `ExternalThread`, with its own
 * composer — this hidden instance's composer is never shown. Without the
 * skip, this hook's mount effect (which runs well before the zone itself
 * renders) always wins `draft-stash`'s one-shot take and seeds a composer
 * nobody sees, leaving a "Fork from here" prefill (or a #178 offload-release
 * restore) empty in the zone that actually displays.
 *
 * Zone MEMBERSHIP alone over-skips: `ChatSurface` only renders the split (and
 * mounts `ChatZone`, the other consumer) when `splitFits` is ALSO true (the
 * surface is wide enough for two zones — see `zones-store`'s `splitFits` and
 * `ChatSurface`'s split branch). In a narrow window, a zone member still
 * renders through THIS hook's instance as the plain single-chat view, so
 * skipping here too would leave NEITHER consumer taking the stash: the
 * composer renders empty now, and a later `ChatZone` mount (once the window
 * widens) would apply the stash stale, overwriting anything the user typed or
 * sent in the meantime. Skip only when the split will actually render this
 * chat: it's a zone member, the FOCUSED chat is in the same pair, and the
 * surface currently fits two zones — or the pair is still queued
 * (`pendingPair`) for a surface that already fits.
 */
import { useAuiState } from '@assistant-ui/react';
import type { AssistantRuntime } from '@assistant-ui/react';
import { chatControllerRegistry } from './chat-controller-registry';
import { useDaemonPort } from './daemon-port-context';
import { useChatThreadRuntime } from '../../chat/runtime/use-chat-thread-runtime';
import { isVisibleZone, useZonesStore } from '../../chat/zones/zones-store';

export function useChatRuntimeHook(): AssistantRuntime {
  const chatId = useAuiState((s) => s.threadListItem.id);
  // Subscribe to the DERIVED active boolean, not the raw mainThreadId. aui keeps
  // every visited thread's subtree mounted, so a raw `mainThreadId` subscription
  // re-runs this hook (and re-renders that subtree) in EVERY warm thread on each
  // switch — cost grows with session count. Selecting the boolean means only the
  // two threads whose active-ness actually flips re-render.
  const isActive = useAuiState(
    (s) => s.threads.mainThreadId === s.threadListItem.id && s.threadListItem.remoteId != null,
  );
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const port = useDaemonPort();

  const controller = chatControllerRegistry.getOrCreate(chatId, port);

  const zones = useZonesStore((s) => s.zones);
  const splitFits = useZonesStore((s) => s.splitFits);
  const pendingPairTarget = useZonesStore((s) => s.pendingPair?.[1]);
  const splitWillRender = splitFits && isVisibleZone(zones, mainThreadId);
  const skipDraftRestore =
    (isVisibleZone(zones, chatId) && splitWillRender) || (pendingPairTarget === chatId && splitFits);

  return useChatThreadRuntime(controller, port, { active: isActive, chatId, skipDraftRestore });
}
