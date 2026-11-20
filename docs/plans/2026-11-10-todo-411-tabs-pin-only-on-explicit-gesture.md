# Todo #411: pin tabs only on an explicit gesture (short form)

Route: no-spec, working from the approved brief. The expected source diff is under 150 lines, so this is the short-form plan with one implementation group and TDD inline.

## Goal

Being a member of the split pair (visible or parked) holds a session's tab open in the strip, but it no longer pins it. Only double-click, "Keep open" and the existing `pinTab` gestures write `tabIds`. When the pair dissolves or a member is replaced, a session that was only held by the split leaves the strip, unless it is the active session, which stays as the preview. Explicit pins survive split changes. Persistence keeps writing `tabIds` and the zone pair separately, so a restored pair restores held members, not pinned ones. Forks still open beside their parent, with no pin side effect.

## Files

All paths are under `packages/ui/src/features/`.

- `session-tabs/tabs-model.ts`: derive the held set, and make `displayedTabIds` and `stripEntries` show it.
  - Add a pure helper `heldTabIds(state, zones, items)`. It returns the zone members that are regular list entries and are not already pinned, the preview or the draft.
  - `displayedTabIds` and `stripEntries` accept the held ids, for example as an optional `heldIds` on the state argument. Held ids go after the pinned tabs and before the preview. Each id appears exactly once. The existing pair regrouping then places the pair at its first member's position.
  - ⌘1–9 and ⌃Tab keep counting the members individually.
  - Unlisted or archived members must not appear. Before this change, `reconcileTabIds` handled that by pruning them from `tabIds`.
- `session-tabs/use-session-tabs-sync.ts`: stop promoting zone members to pinned.
  - Delete the "Zones ⊆ pinned tabs" effect, which calls `ensureTab(id, 'pinned')` and `pinTab`.
  - Change the membership seam:
    - Skip `ensureTab` when `mainThreadId` is a member of the current pair, so that clicking a member never evicts an unrelated preview.
    - Add the zone pair to the seam's dependencies. After a dissolve or `replaceZone` that leaves the active session outside the pair, the seam re-runs and makes that session the preview (or the draft).
  - Persistence code needs no change beyond the pins no longer being written.
- `session-tabs/store.ts`: `pinTab` must also pin a held member that sits in no slot, by consulting `useZonesStore.getState().zones`. This is the "Keep open" and double-click path on a held pill. `pinTab` on an id that is neither open nor a member stays a no-op, as `store.test.ts` asserts. Update the doc comments for `ensureTab` and `pinTab`.
- `session-tabs/SessionTabs.tsx`: compute the held ids and pass them to `displayedTabIds` and `stripEntries`, for both the display order and the close-order lists. In `entryOf`, the `preview` flag becomes "not pinned and not the draft". Held pills then get the existing preview look and the "Keep open" menu item.
- `session-tabs/use-tab-hint-index.ts` and `chat/zones/use-zone-shortcut-actions.ts` read `displayedTabIds` too. Pass them the same held ids so that hint badges and ⌘⇧\ agree with the strip.
- Tests in `session-tabs/__tests__/`, written red first and then made green:
  - `tabs-model.strip.test.ts` (or a new `tabs-model.held.test.ts`):
    - A held member that is not pinned is displayed exactly once.
    - Keyboard and hint indexes count it.
    - It disappears once the pair is null.
    - Unlisted members are excluded.
  - `store.test.ts`: `pinTab` on a held member pins it and clears nothing else.
  - `use-session-tabs-sync.zones.test.tsx`:
    - Fork from a preview parent: neither tab is pinned.
    - Activating a parked member does not pin it and does not replace the preview.
    - Dissolving leaves no member pinned, the active member as the preview, and the others gone.
    - An explicit pin made before or during the split survives the dissolve.
    - A restored pair does not add members to the persisted `ids`.
  - Update the existing zones, fork and split tests in `SessionTabs.fork.test.tsx` and `SessionTabs.split.test.tsx` that assert zone members end up pinned. They now assert held-but-unpinned.
  - Add one "Open side chat" case that leaves a preview parent as the preview, wherever side-chat opening is already tested against the tab store.
- `.changeset/*.md`: a patch changeset for the UI package.

## Risks

- Re-preview on zone change. The seam now re-runs when the pair changes. It must only add the active session to a slot. Closing the active tab always moves focus or starts a new session, so a session the user closed is not re-added in practice. Cover the dissolve paths (⌘\, the tab menu "Close split", and closing a member's tab) with tests.
- Pair regrouping requires both members to be displayed. Held derivation guarantees that whenever both members are listed. If a member is unlisted, the other member shows as a lone tab, which is today's behavior after a prune.
- Users whose tabs were already pinned by this bug keep those pins. That is the brief's decision, and no migration is planned.

## Established facts

- Split membership is the only automatic writer of pins: the "Zones ⊆ pinned tabs" effect calls `ensureTab(id, 'pinned')` and then `pinTab(id)` on every change to `zonesPair` or `previewId` (`use-session-tabs-sync.ts`, `useSessionTabsSync`).
- A fork queues `queuePair(anchor, chat.id)` and switches to the fork. `useZonesReconciler` opens the pair once the fork is listed (`sessions/use-fork-chat.ts` `useForkChat`, `chat/zones/use-zones-reconciler.ts` `pendingPair` effect).
- Local (`__LOCALID_*`) ids can never become zone members, because `canOpenInSplit` rejects them (`chat/zones/open-in-split.ts` `canOpenInSplit`). The members therefore match the remote-keyed canonical tab ids.
- The pair is edited only by `openSplit`, `replaceZone` and `closeSplit` (`chat/zones/zones-store.ts`). Their callers are `open-in-split.ts`, `ZoneDropLayer.tsx`, `use-session-tab-handlers.ts` (`onClose`, `onCloseSplit`) and the restore path in `useSessionTabsSync`.
- `pinTab` on an id in no slot is a no-op, and a test asserts it (`__tests__/store.test.ts`, `describe('pinTab')`).
- Persistence writes `ids` from `tabIds` only. `zones` is written separately, and restore calls `openSplit` without touching `tabIds` (`useSessionTabsSync` persist and hydrate effects).
- `displayedTabIds` is consumed by `SessionTabs.tsx`, `use-tab-hint-index.ts` and `chat/zones/use-zone-shortcut-actions.ts`. A grep of `packages/ui/src` outside tests finds no other caller.
- `docs/plans/` is gitignored (`.gitignore`), so plans are committed with `git add -f`.

## Exit gates

- Every acceptance criterion in the brief maps to a unit test in the tabs model, store or sync tests. Each test was observed failing before the implementation and passes after.
- The existing session-tabs and zones test suites pass. The UI package typecheck and lint are clean.
- A grep finds no remaining `ensureTab(…, 'pinned')` or `pinTab` call in `use-session-tabs-sync.ts`.
- A changeset is included.
