# Viewing multiple chats at once — design and feasibility (todo #244)

## Problem

Everything the app shows derives from one active session. The assistant-ui thread
list exposes a single `mainThreadId`; the WebSocket subscription is gated to that
one thread; a single `useActiveIdentity()` scope drives the Files tree, the editor,
Run terminals and launches, the todos board, automations, the skills panel, and
layout persistence. Switching sessions swaps all of it at once, so a user watching
one agent work cannot see a second one at the same time.

## Goal

Decide whether "multiple chats visible at once" is buildable, in what shape, and at
what cost — and name the smallest cut that ships. This document is the deliverable;
no code changes accompany it.

*On the location:* this is the repo's first `docs/research/` entry. A feasibility
study is neither a recorded decision (`docs/adr/`) nor a committed spec, and filing
it under either would imply a commitment that has not been made. Dated
`docs/research/<date>-<todo>-<slug>.md` files keep investigation output separate
from both.

## Out of scope

Implementing split panes, multi-window, or any WS gating change. Redesigning the
Chat/Files/Run surface model beyond what multi-chat requires. Multi-daemon and
multi-machine scenarios.

---

## What already works

Three pieces of the system are already N-chat-ready. They are the reason this is a
renderer problem, not an architecture problem.

**The daemon serves N concurrent chat subscriptions per connection, today.** Each WS
connection owns a `subscriptions: Arc<Mutex<HashSet<String>>>`
(`packages/core-rs/crates/mainframe-server/src/websocket.rs:61`); `subscribe` inserts
(`:431`), `unsubscribe` removes (`:451`), and there is no cap. Fan-out tests the set
per client per event (`:648-677`, delivery rule at `:668-671`): an event carrying a
`chatId` reaches only subscribers of that chat, three notification types are
connection-global (`CONNECTION_GLOBAL_EVENT_TYPES`, `:51-55`), and events without a
`chatId` reach everyone. Subscribing to two chats is the same code path as
subscribing to one.

**One socket carries all of it.** `daemonWs` is a module singleton
(`packages/ui/src/lib/daemon/ws-client.ts:237`) exposing `subscribe(chatId)` /
`unsubscribe(chatId)` (`:163`, `:167`). A second live pane sends one more `subscribe`
frame on the existing socket — no second connection.

**Every visited chat is already warm.** `chatControllerRegistry`
(`packages/ui/src/features/sessions/runtime/chat-controller-registry.ts`) is a
`Map<string, ChatThreadController>` keyed by the stable thread id; `getOrCreate` is
idempotent and `disposeAll()` is called from exactly one place, the daemon switch
(`packages/ui/src/lib/daemon/dispose-daemon-session.ts:24`). Controllers keep their
projection across session switches. Dormancy is enforced *only* at the live-WS layer:
`subscribeState` never touches the network, `subscribeLive` is ref-counted
(`packages/ui/src/features/chat/controller/chat-thread-controller.ts:95-150`).

The consequence: the incremental cost of a second visible chat is a WS subscribe
frame and a second render tree. Not memory, not a daemon change, not a new connection.

---

## Coupling inventory

Every single-active-session coupling point in the renderer, with a verdict.
*Unchanged* = works as-is under the recommended MVP. *Per-pane* = must become
pane-scoped. *Follow-focus* = stays global, tracks the focused pane.

### Runtime

| # | Coupling | Evidence | Verdict |
|---|---|---|---|
| 1 | `isActive = mainThreadId === threadListItem.id && threadListItem.remoteId != null` gates the live WS sub | `features/sessions/runtime/use-chat-runtime-hook.ts:29-31` | **Per-pane** — the equality becomes set membership; the `remoteId` guard stays |
| 2 | `useEffect(active) → controller.subscribeLive()` | `features/chat/runtime/use-chat-thread-runtime.ts:107-112` | **Unchanged** (ref-counted; N callers are safe) |
| 3 | One `AssistantRuntimeProvider` at the app root | `app/AppShell.tsx:199-207` | **Unchanged** — stays the global thread-list root |
| 4 | One `useRemoteThreadListRuntime` instance | `features/sessions/runtime/use-sessions-thread-list.ts` | **Unchanged** — one list, N views |
| 5 | `_mainThreadId` is a single scalar per runtime-core | `@assistant-ui/core@0.2.21` `RemoteThreadListThreadListRuntimeCore` (`get mainThreadId`, mutated only in `switchToThread`) | **Unchanged** — the focused pane keeps being "main" |
| 6 | `ChatSurface` reads ambient `s.threads.mainThreadId` | `features/sessions/new-thread/ChatSurface.tsx:74,79,81` | **Per-pane** — extract a `ChatPane({ chatId })` |
| 7 | `ChatCardHeader` reads ambient `threadListItem` title/custom/status | `features/chat/thread/ChatCardHeader.tsx:56,57,147,148` | **Per-pane** — needs an injected `threadListItem`, *and* must suppress or re-scope its global controls: the layout split/floor buttons (`useLayoutStore`, `:60-63`) and the Review button (`:73-82`, which fires a global `open-review` intent) belong to the focused pane only |
| 8 | New-thread draft machinery (`useNewThreadAutoConfig`, zero-session picker) | `features/sessions/new-thread/ChatSurface.tsx:70-95` | **Unchanged** — focused pane only; a draft is never a secondary pane |
| 9 | `resume_chat` fires on every `subscribe:ack` | `features/chat/controller/chat-ws-subscription.ts:123` → `mainframe-chat/src/lifecycle_manager.rs:323-348` | **Per-pane, with care** — see Q4 |

### Identity scope

| # | Coupling | Evidence | Verdict |
|---|---|---|---|
| 10 | `useActiveIdentity()` derives project/adapter/worktree/chat from the one global `threadListItem` | `features/sessions/use-active-identity.ts:45-47` | **Follow-focus** |
| 11 | 22 files / 23 call sites consume it (below) — `layout/SurfacePicker.tsx` calls it twice, at `:41` and `:81` | grep, `app/**`, `components/**`, `features/**`, `layout/**` | **Follow-focus** |
| 12 | `useActiveBasesStore` + `activeLaunchScope` pushed once from `AppShell` | `app/AppShell.tsx:85-88` | **Follow-focus** |
| 13 | `MainToolbar` receives `projectId`/`chatId` as props | `app/AppShell.tsx:161-172` | **Follow-focus** |

The 22 consumer files (23 call sites), all of which stay follow-focus under the MVP:
`app/AppShell.tsx:81` · `layout/SurfacePicker.tsx:41,81` · `layout/RunTabStrip.tsx:117` ·
`layout/surfaces/RunSurface.tsx:164` · `features/tasks/TasksSidebarSection.tsx:47` ·
`features/tasks/TasksModalHost.tsx:28` · `features/viewers/UnsupportedViewer.tsx:45` ·
`features/viewers/PdfViewer.tsx:52` · `features/viewers/viewer-router.tsx:92` ·
`features/review/ReviewPanel.tsx:29` · `features/files/InspectorPane.tsx:29` ·
`features/files/FilePickerDialog.tsx:121` · `features/preview/use-send-captures.ts:10` ·
`features/preview/PreviewInstance.tsx:39` · `features/automations/AutomationsHost.tsx:23` ·
`features/context-panel/use-sidebar-skills.ts:22` ·
`features/context-panel/use-session-context.ts:17` · `features/editor/EditorTab.tsx:51` ·
`features/editor/DiffTab.tsx:38` · `features/editor/inline-comments/use-send-review.ts:10` ·
`features/palette/SpotlightPalette.tsx:146` · `components/overlays/FindInPathModal.tsx:111`.

### Layout and persistence

| # | Coupling | Evidence | Verdict |
|---|---|---|---|
| 14 | `SurfaceId = 'chat' \| 'files' \| 'run'` — a closed union with one chat slot | `store/layout.ts:22` | **Unchanged** — the split lives *inside* the chat surface |
| 15 | `placeInLayout` special-cases chat (always leftmost, demotes on overflow) | `store/layout.ts:52-68` | **Unchanged** |
| 16 | `litSurfaceCount` / `isSurfaceFloor` (dynamic floor) | `store/layout.ts:110-123` | **Unchanged** |
| 17 | `SurfaceView` renders exactly one global `ChatSurface` | `layout/SurfaceHost.tsx:26-30,102,132` | **Per-pane** — one line, delegates to a split container |
| 18 | `setActiveSession(chatId)` swaps the whole `SessionWorkspace` | `store/layout.ts:199-206` | **Follow-focus** — keyed by the focused chat |
| 19 | `SessionWorkspace = { layout, run }` persisted per chat | `store/layout.ts:38-42`, `store/layout-persist.ts:30-37` | **Per-pane, additively** — two new fields |
| 20 | `mf:session-layout::<daemonId>` in localStorage, `__LOCALID_*` excluded | `store/layout-persist.ts:33,57` + `lib/daemon/daemon-scoped-storage.ts` | **Unchanged** |
| 21 | `pruneSessions(validIds)` GC | `features/sessions/ws/use-session-list-router.ts:210-214` | **Unchanged** — must also drop dangling peer ids |
| 22 | `tabs.ts` / `editor.ts` / `files.ts` are global singletons with zero session keying | `store/tabs.ts`, `store/editor.ts`, `store/files.ts` | **Unchanged** (follow-focus by construction) |

### Unread, notifications, navigation

| # | Coupling | Evidence | Verdict |
|---|---|---|---|
| 23 | `activeChatIdsRef` is built from `mainThreadId` alone; notifications for it are skipped | `features/sessions/ws/use-session-list-router.ts:70-76,105-111` | **Per-pane** — union of visible pane chats |
| 24 | Unread cleared only for `mainThreadId` / its `remoteId` | `features/sessions/ws/use-session-list-router.ts:179-181` | **Per-pane** — clear for every visible pane |
| 25 | `unread: Set<string>`, client-only, no server concept | `store/unread-store.ts:8-35` | **Unchanged** |
| 26 | `SessionListRouter` routes `chat.notification` / `permission.requested` → markUnread | `features/sessions/ws/session-list-router.ts:74-80` | **Unchanged** |
| 27 | `setSessionNavigator` is a module singleton; toasts deep-link through it | `lib/session-nav.ts`, `app/AppShell.tsx:64-67` | **Follow-focus** — "Open session" targets the focus pane |
| 28 | `mfToast` errors/permissions persist with `Infinity` duration | `lib/toast.ts` | **Unchanged** |
| 29 | Boot auto-select picks one session | `features/sessions/ws/use-session-list-router.ts:194-205` | **Unchanged** — restores the focus pane only |
| 30 | Archived-active fallback switches the one main thread | `features/sessions/ws/use-session-list-router.ts:139-173` | **Per-pane** — a peer pane must close, not redirect |
| 31 | Debounced `threads.reload()` on every `chat.updated` burst | `features/sessions/ws/use-session-list-router.ts:85-100` | **Unchanged** — already coalesced |

### Composer, gates, sends

| # | Coupling | Evidence | Verdict |
|---|---|---|---|
| 32 | `onNew` writes to the controller the runtime was built from | `features/chat/runtime/use-chat-thread-runtime.ts:138-147` | **Unchanged** — targeting is structurally correct per pane |
| 33 | Gate cards mount inline at the thread tail, reading `extras.permissions` | `features/chat/gates/`, `ChatThread.tsx` | **Unchanged** — already per-runtime |
| 34 | Global hotkeys (⌘N, ⌘1/2/3, ⌘O, ⌘,) are `window`-scoped | `layout/SurfaceHost.tsx:72-86`, `features/sessions/use-new-chat-hotkey.ts:21`, `app/use-global-overlay-hotkeys.ts:22` | **Follow-focus** |
| 35 | Singleton overlay hosts (palette, review, tasks, automations, settings, dialogs) mounted once | `app/AppShell.tsx:180-194` | **Follow-focus** |

---

## Q1 — Product shape

**Recommendation: an in-window split *inside the chat surface*, with one focused
interactive pane and one secondary pane that follows its session live but shows no
composer.** The secondary pane is opened from the sidebar (a "Open beside" context
action on a session row) or by dragging a session row onto the chat surface; it is
closed by its own header ✕; and it is promoted by a "Focus" affordance in its header,
which swaps it into the focus slot and demotes the previously focused chat into the
peer slot. That swap is an explicit two-workspace write, not a bare
`setActiveSession` — see Q5 for why and for the self-peer guard it needs. Focus is
explicit and single — clicking anywhere in the peer pane does not
steal focus, because focus moves the entire Files/Run/Tasks context with it and a
stray click must not do that.

Why "inside the chat surface" rather than "a second surface slot": `SurfaceId` is a
closed three-value union (`store/layout.ts:22`) with chat hard-coded as leftmost and
as the overflow-demotion pivot (`:52-68`), and it feeds the drop targets
(`layout/SurfaceHost.tsx:101,131`), the ⌘1/2/3 map (`:15-19`), the surface rail, and
the floor math (`:110-123`). Adding a `'chat2'` member touches all of it for something
that is not a surface. Splitting inside the surface leaves every one of those files
alone; the precedent already exists one level down in `store/run-pane.ts` (`MAX_PANES = 2`,
`:59`, with edge-drop splitting at `:192-207`).

**Rejected — a second app window per session.** Feasible, but it is the most expensive
option by a wide margin, and the expense is all in places unrelated to multi-chat:

- The app builds its one window manually (`packages/app-tauri/src-tauri/src/lib.rs:142-152`)
  because `tauri.conf.json` sets `"create": false`; a second window needs its own
  config entry and a second builder call that re-attaches the `no-store`
  `on_web_resource_request` — omitting it reintroduces the WKWebView stale-asset bug
  fixed in PR #453.
- Tauri's ACL is window-label-scoped: `capabilities/main.json:6` is `"windows": ["main"]`,
  so a second label gets **zero** permissions until a capability is added.
- Shutdown assumes one window. `lib.rs:250-275` (`WindowEvent::Destroyed`) kills the
  daemon, every PTY, and every preview webview; `lib.rs:278-295` (`RunEvent::Exit`)
  repeats it. Closing the second window would kill the first window's daemon. A
  "last window" guard is mandatory before a second window is safe at all.
- `lib.rs:235-249` (`on_page_load` preview teardown) is hard-coded to the `"main"` label.
- Renderer state splits the wrong way. Each Tauri window runs its own JS module graph,
  so `active-daemon.ts` (a module-level `let`), `chatControllerRegistry`,
  `lib/session-nav.ts`, and the draft stores are all duplicated per window — while
  `localStorage` is origin-shared, so `mf:session-layout`, `mf:ui-prefs`,
  `mf:last-session`, `mf:filterProjectId`, and the theme keys race last-writer-wins
  across windows. Worse, `daemonScopedKey()` (`lib/daemon/daemon-scoped-storage.ts:8-10`)
  derives its suffix from the per-window `getActiveDaemon()`, so two windows that
  disagree on the active daemon read *different keys for the same logical data*.
  Fixing this properly means window-scoping every persisted store — a larger refactor
  than the entire in-window split, for a smaller product win.

The multi-window option should be revisited only if users ask for chats on separate
monitors. It is not the cheap version of this feature.

**Rejected — a "peek" popover or hover preview.** Cheap, but it answers a different
question ("what did that chat just say?") than the one asked ("watch two agents work").
A transient surface cannot host a scrollable transcript or tool cards without becoming
a pane anyway.

**Rejected — tabs within the chat surface (one visible at a time).** That is what the
sidebar already is. It adds chrome without adding simultaneity.

---

## Q2 — Context ownership

**Recommendation: chat content is per-pane; every session-scoped surface follows
focus.** The focused pane owns `useActiveIdentity()`, and therefore owns the Files
tree, the editor tabs, Run terminals and launches, the todos board, automations, the
skills/agents panel, the review panel, the palette's project scope, and the layout
workspace. The peer pane renders only its transcript and its header.

This is the only option that costs nothing in the inventory above: entries 10-13 stay
follow-focus, and entries 14-22 stay unchanged. Per-pane scoping of the surfaces would
mean threading a scope argument through 23 call sites *and* keying `tabs.ts`,
`editor.ts`, `files.ts`, `run-pane.ts`, and the terminal cache by session — none of
which have any session keying today (entry 22). That is a multi-week refactor with a
live-PTY correctness hazard: `killAndDisposeCachedTerminals`
(`store/terminal-cleanup.ts:13`) kills an explicit id list, and the ids come from the
scope-keyed `releaseRunScope` (`store/layout.ts:303`, via
`terminalIdsForScope(run, scopeKey)`) — re-keying the scope re-keys what gets killed.
And it is not what the todo asks for.

The design consequence to accept honestly: the peer pane's transcript will reference
files and terminals that the visible Files/Run surfaces are not showing. The
mitigation is that "Focus" is one click away in the peer header, and focusing swaps
the whole context atomically via the existing `setActiveSession` path
(`store/layout.ts:199-206`).

**Rejected — per-pane scoping of Files/Run.** Right in the long run, unaffordable now,
and it would require deciding what a two-project split even means for the single
`MainToolbar` project/branch chip and the single Inspector.

**Rejected — a hybrid where the peer pane gets its own Files tree only.** The Files
surface reads `projectId`/`chatId`/`projectPath` from the same hook as everything
else; carving out one consumer means the scope is no longer a single derived value,
which is exactly the property that makes the current design tractable.

---

## Q3 — Runtime architecture

**Recommendation: a nested `AssistantRuntimeProvider` per pane, fed by the *same*
warm controller from the global registry — not `ReadonlyThreadProvider`.**

The mechanism is sanctioned by the library and gives a clean scope boundary.
`AssistantProviderBase` calls `useAui({ threads: RuntimeAdapter(runtime) }, { parent })`
with `parent` defaulting to `null` (`@assistant-ui/core@0.2.21`
`dist/react/AssistantProvider.js`), so a nested provider creates a *fresh root* aui
scope: descendants see the pane's `threads`, `thread`, and `composer`, and nothing
leaks in from the outer session. `_mainThreadId` is per runtime-core instance
(`RemoteThreadListThreadListRuntimeCore`), so two providers cannot fight over it.

The pane runtime is built the same way the focused one is:

```
const controller = chatControllerRegistry.getOrCreate(paneChatId, port);
const runtime = useChatThreadRuntime(controller, port, { active: true });
```

Calling `useChatThreadRuntime` twice against one controller is safe by construction:
`subscribeState` is a plain multi-listener registration
(`use-chat-thread-runtime.ts:74`), `controller.load()` is deduped by an internal
`loadPromise` (`:101-103`), and `subscribeLive()` is ref-counted so the second caller
increments rather than opening a second socket
(`chat-thread-controller.ts:95-150`). Both panes therefore read one projection and one
event stream.

**Why not `ReadonlyThreadProvider`.** It is already used in-repo for subagent
transcripts (`features/chat/tools/cards/TaskCard.tsx:23`), so it is proven — but it
overrides **only** `thread` and `composer` (`@assistant-ui/core@0.2.21`
`dist/react/providers/ReadonlyThreadProvider.js`, `useAui({ thread, composer })`), and
it hard-codes a synthetic list item (`{ id: 'readonly', isMain: true, ... }`) that is
never exposed. Inside such a pane, `s.threads` and `s.threadListItem` still resolve to
the **outer, focused** session. Every component that reads identity from context —
`ChatCardHeader.tsx:56,57,147,148`, anything derived from `useActiveIdentity` — would
silently render the wrong chat's title, status, and scope. It also takes a static
`readonly ThreadMessage[]`, so live-following would mean re-projecting the controller
state into an array by hand and losing the repository's branch/queue handling.

**The one gap the nested provider has, and its fix.** A bare `useExternalStoreRuntime`
synthesizes a single-entry thread list: `threadListItem.id === "DEFAULT_THREAD_ID"`,
with no `remoteId`, `title`, `custom`, or real `status`
(`@assistant-ui/core@0.2.21` `dist/runtimes/external-store/external-store-thread-list-runtime-core.js:3-12`).
Fix it by wrapping the pane's children in `ThreadListItemRuntimeProvider` with the
item runtime taken from the **outer** thread list before entering the pane — the exact
pattern already shipped in `features/sessions/sidebar/SessionRow.tsx:268-276`:

```
const itemRuntime = useAssistantRuntime().threads.getItemById(paneChatId);
// inside the nested provider:
<ThreadListItemRuntimeProvider runtime={itemRuntime}>…</ThreadListItemRuntimeProvider>
```

That restores `threadListItem.id/remoteId/title/status/custom` inside the pane.
Residual: `activeSessionCustom` prefers the `remoteId`-keyed entry from
`s.threads.threadItems` (`features/sessions/view-model/chat-to-thread-custom.ts:147-153`),
which inside the pane is the degenerate single-entry list, so it falls back to
`item.custom`. That fallback is stale only for `__LOCALID_*` threads, and a draft can
never be a peer pane — so it is correct for every case the MVP allows.

Nothing in the chat subtree calls `useAssistantRuntime()`. Verified by grep over
`packages/ui/src`: 19 non-test hits, three of them comments, leaving **16 call
sites** — in `app/`, `layout/`, `features/sessions/`, `features/review/`,
`features/tasks/`, `features/tour/`, `features/git/`, and `features/palette/`. None
is under `features/chat/`, so the pane's degenerate `threads` scope is not otherwise
observed.

The two directories outside the obvious set are still outside the chat subtree where
it counts — at render time:

- `features/git/use-worktree-session.ts:17` is reached only via
  `use-new-session-action.ts:26` → `BranchPopover.tsx:165`, and `BranchPopover` is
  rendered from exactly one place, `layout/MainToolbar.tsx:162`.
- `features/palette/SpotlightPalette.tsx:142` is a singleton overlay mounted at the
  app root, not inside a pane.

**Read-only is a rendering choice, not a runtime one.** Because the pane owns a real
external-store runtime, making it interactive later is "render the composer and the
gate mount" — the send path (`onNew`, `use-chat-thread-runtime.ts:138-147`) already
targets the pane's own controller. The MVP ships it without a composer for the
product reason in Q6, not a technical one.

**Rejected — a second `useRemoteThreadListRuntime` (a full second thread list) per
pane.** It works, and it is what a second *window* would do, but in one window it
duplicates `adapter.list()` on every reload and gives the two instances unsynced
optimistic metadata: an archive or rename in one pane would not appear in the other
without bespoke cross-instance sync. The single global list plus N thread *views* has
none of that.

**Rejected — `useThreadRuntime(threadId)` to bind an arbitrary warm thread.** No such
API: `useThreadRuntime(options?: { optional })` takes no thread id and resolves only
the currently scoped thread. The `RemoteThreadListHookInstanceManager` does keep one
runtime per alive thread (`instances: Map<string, …>`, `getThreadRuntimeCore(threadId)`)
and mounts a subtree per alive thread via `__internal_RenderThreadRuntimes` — but
those subtrees render only the binder, and the accessor is `__internal_`-prefixed
private API. Building on it would couple us to unversioned internals of a sub-1.0
package we already exact-pin for stability.

---

## Q4 — Transport

**Recommendation: change the gate from equality to set membership, and nothing else.**

The equality in `use-chat-runtime-hook.ts:29-31` becomes a membership test against a
small store of "chat ids currently visible in a pane", with `mainThreadId` always a
member. The `&& threadListItem.remoteId != null` conjunct stays exactly as it is — a
local `__LOCALID_*` thread has no daemon chat and must never open a live sub. That is
the entire transport change. Everything downstream already handles N:

- `subscribeLive` ref-counting means a chat visible in two places opens one sub
  (`chat-thread-controller.ts:95-150`).
- `ChatWsSubscription.attach()` sends one more `ws.subscribe` frame on the shared
  socket (`chat-ws-subscription.ts:65-82`, `ws-client.ts:163`).
- The daemon inserts one more id into the per-connection `HashSet`
  (`websocket.rs:431`) and fan-out already evaluates the set per event (`:668-671`).
- Reconnect and re-seed semantics are per-controller and already correct for N:
  `handleSubscribeAck` re-seeds only when `reconnect || isReattach() || hasUnreconciledPendings()`
  (`chat-ws-subscription.ts:133`), which is a property of that controller's own
  history, not of which chat is focused.

**The one real cost, and the one thing to watch.** `handleSubscribeAck`
**unconditionally** calls `resumeChat(port, chatId)` (`chat-ws-subscription.ts:123`).
On the daemon that is not a read: `resume_chat` loads the chat and, if
`process_state == Working` and (yolo || no pending permission), calls `start_chat`
(`packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs:323-360`; route at
`routes/chat_commands.rs:159-170`). Today this fires once per focus change; with N
panes it fires once per pane attach.

*A peer attach rarely respawns anything.* `start_chat` early-returns when the chat
already has a spawned session: it re-emits `ProcessStarted` and stops
(`lifecycle_manager.rs:434-442`). A respawn therefore needs `process_state == Working`
**and** no live session — the post-daemon-death or post-process-death state, which is
exactly when a resume is what the user wants. The risk is narrow: attaching a peer
pane to a chat whose CLI is alive costs a no-op plus one `ProcessStarted` event.

*The unconditional emit is the per-attach cost that always lands.* Whatever
`start_chat` decides, `resume_chat` always emits `ChatUpdated`, plus `TodosUpdated`
when the chat has todos (`lifecycle_manager.rs:350-359`). `ChatUpdated` feeds
`scheduleReload` in `use-session-list-router.ts:85-100`, which re-runs the **whole**
thread list. The debounce is leading-edge, so the first attach reloads immediately:
opening a peer pane costs a full list refetch, and a focus swap costs two — one per
pane re-attach — unless both land inside the same 200 ms window. Two options, in
order of preference:

1. Ship as-is for the MVP. Both costs are bounded: the reload is already debounced and
   already fires on every focus change today, and the respawn only happens when the
   process is genuinely gone.
2. If QA shows either is disruptive, add an additive `resume` flag to the `subscribe`
   frame so a peer pane can attach without resuming. This *is* a daemon contract
   change — see "Backend impact".

**Fan-out and memory cost, measured against what already happens.** Two live panes
mean the union of two chats' event streams on one socket. A streaming chat's token
deltas already flow at full rate when focused; the delta is that a second chat's
stream now also lands, and each landing re-runs that controller's reducer plus
`projectChatThreadRepository` (`use-chat-thread-runtime.ts:116`, memoized on `state`,
so it re-projects per state change). Controller memory is unchanged — those
controllers are already warm in the registry whether or not they are visible. There
is no per-chat cap on the daemon side, so the ceiling is renderer render cost, which
is why the MVP caps panes at two.

**Rejected — a second WebSocket connection per pane.** Buys nothing: subscriptions are
per-connection sets, not per-connection chats, and a second connection would double
the replay-on-connect traffic (`websocket.rs`, connect-time replay) and the
connection-global notification stream (`:51-55`), producing duplicate toasts.

**Rejected — leaving the peer pane dormant and polling REST.** Kills the entire point
(live following), and re-seeding on a timer would fight the refetch-on-gap design.

---

## Q5 — Layout

**Recommendation: two additive fields on `WorkspaceLayout`, persisted through the
existing per-session workspace, plus one new store action for the focus swap.**

```
interface WorkspaceLayout {
  top: SurfaceId[];
  bottom: SurfaceId | null;
  topFlex: Partial<Record<SurfaceId, number>>;
  vFlex: { top: number; bottom: number };
  peerChatId?: string | null;   // new
  peerFlex?: number;            // new — split ratio inside the chat surface
}
```

`SessionWorkspace` (`store/layout.ts:38-42`) is already keyed by the focused chat id
and already persisted per session (`store/layout-persist.ts:30-37`, storage key
`mf:session-layout::<daemonId>`, `__LOCALID_*` excluded at `:33`). Adding `peerChatId`
means "when I focus chat A, chat B reappears beside it" — which is the behaviour a
user would expect — and it rides the existing per-session workspace with no new
storage key.

**Focusing the peer is an explicit two-workspace write, not a bare
`setActiveSession`.** Because `peerChatId` is stored on the *focused* chat's
workspace, the existing swap cannot carry it: `setActiveSession(B)` loads **B's own**
persisted workspace (`store/layout.ts:199-206`), whose `peerChatId` is whatever B last
remembered — not A. "Focus" on a peer pane therefore gets its own store action:

```
focusPeer():  // A = activeSessionId, B = A's peerChatId
  1. keep B as A's peerChatId          — so re-focusing A restores the same pair
  2. write peerChatId = A into B's stored workspace, creating it from
     INITIAL_LAYOUT if B has none     — the step that is easy to forget
  3. setActiveSession(B)
```

Step 2 is the whole reason this is a new action rather than a call into the existing
path. Skip it and the swap silently drops the peer, or resurrects whatever chat B was
last paired with.

**Self-peer guard: `peerChatId` must never equal `activeSessionId`.** A chat cannot be
its own peer — that renders the same transcript twice and opens two subscriptions to
one chat. Two paths produce it: "Open beside" invoked on the chat that is already
focused, and any focus change that lands on the current peer without going through
`focusPeer`. One invariant, enforced in the store, covers both: `setPeer(id)` ignores
`id === activeSessionId`, and `setActiveSession` nulls the loaded workspace's
`peerChatId` when it matches the session being activated.

The lit-surface/floor model is untouched. `litSurfaceCount` and `isSurfaceFloor`
(`store/layout.ts:110-123`) count *surfaces*, and a chat split is one surface with two
panes — exactly as the Run surface is one surface with up to two panes
(`store/run-pane.ts:59`). Hiding the chat surface hides both panes; the floor rule
("the last lit surface can't be hidden") continues to mean what it means today.

One GC addition: `pruneSessions` (`use-session-list-router.ts:210-214`,
`store/layout-persist.ts:47-53`) must also null a `peerChatId` that is no longer a live
chat, or a deleted session would resurrect as an empty pane on the next focus.

**Rejected — a top-level `SurfaceId` for the second chat.** Detailed under Q1. It
turns a two-field change into a change across the layout store, the drop targets, the
shortcut map, the surface rail, and the floor math.

**Rejected — a separate `mf:chat-panes` persisted store.** A second store keyed by the
same chat ids that can drift out of sync with `mf:session-layout` and needs its own
prune, its own daemon scoping, and its own migration. The field belongs where the rest
of the per-session workspace lives.

**Rejected — not persisting the peer at all (session-lifetime only).** Cheaper by
roughly nothing, and it makes the feature feel broken on relaunch — the app already
restores the focused session and its full surface geometry.

---

## Q6 — Interaction semantics

**Unread.** A chat visible in *any* pane is "seen". Two edits, both in
`use-session-list-router.ts`: `activeChatIdsRef` (`:70-76`) becomes the union of
`mainThreadId`, its `remoteId`, the `peerChatId`, and the peer's `remoteId`; and the
unread-clear effect (`:179-181`) clears for every visible pane, not just the main
thread. `unread-store.ts` itself needs no change — it is already a plain id set.

**Notifications and toasts.** Unchanged. `chat.notification` and
`permission.requested` are connection-global on the daemon
(`websocket.rs:51-55`), so they arrive regardless of subscription and the existing
`onMarkUnread` skip (`:105-111`) does the right thing once the ref is a union. The
"Open session →" CTA on `mfToast` keeps routing through the single
`setSessionNavigator` (`lib/session-nav.ts`, `app/AppShell.tsx:64-67`) and therefore
always lands in the **focus** pane — deliberate, because opening a chat is a
context-switching action and should move Files/Run with it.

**Permission gates.** Per-runtime already, so per-pane for free: the gate mount reads
`extras.permissions` from its own runtime (`use-chat-thread-runtime.ts:118-133`,
`features/chat/gates/`). But under the MVP the peer pane renders **no** gate cards. A
permission prompt on the peer chat surfaces as a sidebar unread badge and a toast; the
user focuses that chat to answer. This is the right trade: answering a permission is a
consequential action, and it should happen in the pane whose Files/Run/diff context is
actually on screen. Once focused, the restore-on-attach path
(`chat-ws-subscription.ts:122-136`) redisplays the pending prompt, so nothing is lost
by not rendering it in the peer.

**Send targeting.** Structurally correct and needs no guard rail: each pane's composer
is bound to its own runtime, whose `onNew` writes to that pane's controller
(`use-chat-thread-runtime.ts:138-147`). The MVP still ships the peer without a
composer, because a composer over a pane whose project/branch/Files context is not the
one on screen is a mis-send waiting to happen — the user should focus first. The
follow-up that adds a peer composer should also add a visible per-pane
project/branch label so the target is never ambiguous.

**Focus semantics.** Explicit only: the peer header's "Focus" button (and the
keyboard equivalent) swaps panes. Clicking into the peer transcript does not focus it.
Scrolling, selecting text, and quoting from the peer must all work without moving
focus — quoting from a peer chat into the focused composer is a natural follow-up but
is **not** in the MVP, because quote insertion is bound to the composer's own runtime.

**Archived / deleted peer.** The existing archived-active fallback redirects the main
thread to another session (`use-session-list-router.ts:139-173`). A peer must not
redirect — an archived or deleted peer closes its pane and clears `peerChatId`.

---

## Q7 — Feasibility verdict

**Feasible, and cheaper than it looks.** The daemon needs no change; the transport
change is one predicate; the runtime mechanism is sanctioned by assistant-ui and has
an in-repo precedent for both of its pieces (`SessionRow.tsx:268-276` for injecting a
thread-list item, `TaskCard.tsx:23` for rendering a non-main thread). The cost is
concentrated in component extraction and in the four small "union instead of scalar"
edits.

### MVP cut

1. **Extract `ChatPane({ chatId })`** from `ChatSurface` — header plus transcript, no
   new-thread machinery. `ChatSurface` keeps the draft/picker path and renders the
   focused pane through `ChatPane`.
2. **Add `ChatSurfaceSplit`** inside the chat surface: focused pane, an `x`-axis
   divider reusing `SurfDivider`, peer pane. Two panes maximum.
3. **Peer pane runtime**: nested `AssistantRuntimeProvider` over
   `useChatThreadRuntime(registry.getOrCreate(peerChatId, port), port, { active: true })`,
   with `ThreadListItemRuntimeProvider` injecting the real list item. No composer, no
   gate mount.
4. **Transport**: the `mainThreadId` equality in `isActive`
   (`use-chat-runtime-hook.ts:29-31`) becomes set membership over the visible pane ids.
   Keep the `&& threadListItem.remoteId != null` conjunct — dropping it would let a
   local `__LOCALID_*` thread open a live sub.
5. **Unread union**: the two edits in `use-session-list-router.ts` (`:70-76`, `:179-181`),
   plus "close, don't redirect" for an archived peer.
6. **Layout**: `peerChatId` + `peerFlex` on `WorkspaceLayout`, persisted through
   `SessionWorkspace`, pruned alongside sessions; plus the `focusPeer` action and the
   self-peer invariant from Q5.
7. **Entry points**: sidebar row context-menu "Open beside", peer header ✕ and
   "Focus".
8. **Tests**, against the Q5 semantics: `setPeer` writes `peerChatId` and refuses
   `id === activeSessionId`; clearing nulls it; `pruneSessions` nulls a peer whose chat
   left the list; `focusPeer` writes **both** workspaces, so after the swap
   `activeSessionId` is B and `peerChatId` is A, with no self-peer on either side.
   Plus a pane test asserting the peer renders its own chat's messages while the
   focused header still shows the focused chat; a gating test asserting two subscribes
   and one unsubscribe on close; one e2e covering open-beside → both transcripts live
   → focus swap.

**Effort: ~5-6 focused implementation days; ~1.5 calendar weeks including review,
design conformance, and QA.** Roughly: pane extraction and the nested provider 1 day;
split container and its affordances 1.5 days; transport gate 0.5 day; unread and
navigation 0.5 day; layout persistence 0.5 day; tests 1 day; conformance and polish
0.5 day.

### Non-goals for the MVP

Three or more panes. A composer in the peer pane. Gate cards in the peer pane. Any
per-pane scoping of Files, editor, Run, Tasks, Automations, Skills, or Review. A
second app window. Dragging a session into an arbitrary surface slot. Cross-pane
quoting. Mobile (no layout change ships there).

### Assumptions that must be broken

1. *There is exactly one active chat.* — `use-chat-runtime-hook.ts:29-31`.
2. *The aui main thread is the chat the user is looking at.* — `ChatSurface.tsx:74,79,81`.
3. *`useActiveIdentity()` describes the whole app's scope.* — kept true by making the
   peer chat-only; broken only if per-pane surfaces are ever attempted (23 call sites
   across 22 files).
4. *Unread means "not the main thread".* — `use-session-list-router.ts:70-76,179-181`.
5. *There is one chat slot in the layout.* — `store/layout.ts:22`; kept true by
   splitting inside the surface.
6. *A layout workspace belongs to one session, and `setActiveSession` alone carries
   everything about it.* — `store/layout.ts:199-206`; extended by `focusPeer`'s
   two-workspace write, not replaced.
7. *A `subscribe:ack` is a focus event, so resume-on-attach is fine.* —
   `chat-ws-subscription.ts:123` → `lifecycle_manager.rs:323-360`. The only assumption
   here with a daemon-visible side effect, and the one to watch in QA — though the
   respawn half is narrow (`start_chat` early-returns on a live session, `:434-442`).
   The cost that always lands is the `ChatUpdated` emit (`:350-359`) driving a full
   thread-list reload (`use-session-list-router.ts:85-100`).

---

## Backend impact

**None for the MVP.** The Rust daemon already supports N chat subscriptions per
connection with per-chat fan-out (`websocket.rs:61,431,451,648-677`); no route, event,
or schema changes. Because there is no contract change, **nothing here is
mobile-co-owned**.

One *conditional* follow-up would be: an additive `resume` boolean on the `subscribe`
WS frame, so a peer pane can attach without triggering `resume_chat`'s
`ChatUpdated` emit and its conditional CLI respawn
(`lifecycle_manager.rs:323-360`). That **would** be a daemon contract change and
therefore **mobile-co-owned** — it must be additive (mobile ignores unknown fields,
and an absent flag must keep today's resume-on-subscribe behaviour). Only build it if
QA shows the extra resumes are actually disruptive.

## Open questions

1. **Resume-on-peer-attach**: the respawn path is narrow — `start_chat` early-returns
   on a live session (`lifecycle_manager.rs:434-442`) — so the real question is whether
   the unconditional `ChatUpdated` emit per attach, and the full thread-list reload it
   triggers, are noticeable during a streaming run. Needs a live check before deciding
   whether the `resume` flag is worth building.
2. **Peer composer**: ship it in v2 with a per-pane project/branch label, or keep the
   peer permanently read-only? Product call.
3. **Two panes or N**: is a hard cap of 2 acceptable long-term, or should the split
   container be built to generalize from the start? (Cost of generalizing later is
   low — it is one array in one store.)
4. **Peer entry point**: sidebar context menu only, or also drag-to-split? Drag needs
   `SurfaceDragLayer` involvement and is the more expensive half.
5. **localStorage sharing across Tauri windows** was asserted but not measured; if
   multi-window is ever revisited, verify empirically whether two `WebviewWindow`s on
   `tauri://localhost` share a storage partition before scoping the refactor.
