# Split chat zones — two live transcripts inside the chat surface

Research: `docs/research/2026-08-11-split-chat-view-patterns.md` (Candidate B +
the ExternalThread spike). This plan implements that recommendation with the
user's settled decisions.

**STATUS 2026-08-11: SHIPPED (P1–P4) on `fix/ui-inline-fixes`.** All phases
implemented, live-verified and unit-covered (~85 cases across zones-store,
reconciler incl. the workspace follower, open-in-split, drop layer, hotkey,
v3 persistence with the parked restore, zone unread suppression, tab-strip
⌘-click/grouping). Two user-feedback deltas over the plan: each zone renders
the REAL ChatCardHeader (zone mode with a close ✕) instead of new zone chrome,
and each zone carries its own session panel + rail; the split tab pair also
regroups adjacent under one shared underline. One provider subtlety worth
keeping: a zone's `thread` + `threadListItem` configs must ride ONE AuiProvider
— an inner `extends={aui}` chains to the root and silently drops the outer
scope.

## Decisions (settled 2026-08-11)

| # | Decision | Choice |
|---|---|---|
| 1 | Model | Two zones INSIDE the chat surface; one `SurfaceId`, `layout-placement.ts` untouched |
| 2 | Zone cap | Hard cap at 2 |
| 3 | Focus | Explicit click → `aui.threads.switchToThread(id)`; `mainThreadId` keeps meaning "focused"; all `useActiveIdentity` consumers follow free |
| 4 | Rendering | BOTH zones are `ExternalThread` mounts keyed by chatId while split; the native main-thread tree renders only in single mode. A focus click changes context, never a mount |
| 5 | Unfocused composer | Full composer in both zones; clicking into a zone focuses it first |
| 6 | Narrow widths | Allow and degrade gracefully — no minimum-width gate |
| 7 | Preview slot | Stays global (one preview tab for the window) |
| 8 | Workspace surface | Follows the focused zone via the existing scope stamping (`useActiveIdentity` → `useActiveBasesStore`) — verified, no new wiring. On split start, a top-row workspace auto-moves to the bottom strip (system-moved flag); drag-back clears the flag; unsplit restores only if the flag is intact |
| 9 | Unread | Visible counts as read: unread suppression widens from the main chat to the visible-zone set |
| 10 | Persistence | The split (zone pair + focus) survives reload, stored with `mf:session-tabs` (payload v3) |
| 11 | Entry affordances | Primary: drag a session tab to the chat surface's right edge (drop-zone overlay). Secondary: ⌘-click a tab or sidebar session row. Exit: zone-close X and ⌘\ (closes the focused zone) |

## Mechanism (proven by spike)

`AuiProvider extends={aui} config={AuiConfig({ thread: ExternalThread({...}) })}`
rebinds the `thread` context for a subtree; `projectChatThreadMessages(state)`
already yields the `ThreadMessage[]` it needs; `controller.subscribeLive()` per
zone gives concurrent daemon subs (natively supported). Spike verified: renders,
sends, streams concurrently, no remount across state updates.
`ThreadListItemRuntimeProvider runtime={runtime.threads.getItemById(id)}` rebinds
the item scope (title/status reads) — the runtime object comes from App.tsx, not
the internal hatch.

## Phases

### P1 — zones core (the split renders and works)
- `features/chat/zones/zones-store.ts`: zustand, `zones: [string, string] | null`
  (canonical tab ids), `openSplit(secondId)`, `closeZone(id)`, `closeSplit()`.
  Invariant: while split, `mainThreadId ∈ zones` (reconciled on thread switch —
  a tab click replaces the FOCUSED zone's entry, Claude-Code-desktop rule).
- Extras factory: extract `buildChatExtras(controller, port, state)` and the
  onNew/attachment-restore logic from `use-chat-thread-runtime.ts` into shared
  helpers so the zone mount and the native runtime hook produce identical
  behavior (extras brand symbol stays module-private — factory lives there).
- `features/chat/zones/ChatZone.tsx`: the ExternalThread mount (controller,
  live sub, load, AuiConfig, item-runtime provider) + zone chrome (focus ring /
  unfocused dim, click-to-focus, close X).
- `ChatSurface`: split branch renders two ChatZones + one shared SessionPanel
  (panel floats at the row edge as today; it follows focus by construction).
- Liveness: `use-chat-runtime-hook.ts` predicate becomes membership in
  {mainThreadId} ∪ zones (zones store readable outside React).
- `mainThreadId` sweep inside the chat tree (ThreadFooterInput's projectless
  check, any global-identity read that assumes "this visible thread is main").

### P2 — entry/exit affordances
- Tab strip: third tab state (co-visible-but-unfocused: `data-zone`, subdued);
  ⌘-click a tab/sidebar row opens/replaces the split; plain click replaces the
  focused zone (unchanged single-mode behavior when not split).
- Drag-to-split: pointer-drag on a session tab shows a right-half drop overlay
  over the chat surface; dropping opens the split with that session.
- ⌘\ closes the focused zone.

### P3 — followers
- Unread: `use-session-list-router.ts` `activeChatIdsRef` widens to the visible
  set; unread clears when a chat becomes visible in either zone.
- Workspace auto-move with the system-moved flag (layout store action).
- Persistence: `mf:session-tabs` payload v3 `{ v:3, ids, preview, zones }` +
  migration; hydrate validates both zone ids still resolve.

### P4 — polish + tests
- Dimming/focus treatment pass, narrow-width check, both themes.
- Unit suites: zones-store, reconciliation (tab click replaces focused zone),
  liveness membership, tab third-state; e2e additions listed for the series-end
  batch.
