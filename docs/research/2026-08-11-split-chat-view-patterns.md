# Split-chat view patterns for an agent-orchestration app

Research for the question: what split-view model fits Mainframe when users want 2+ chat
sessions visible at once? The user's settled premise: "active chat" stops meaning
active-TAB and becomes a **focused chat zone**; dependent context (todos plugin project,
session panel, file scope) follows the focused zone.

Every external claim carries a URL. Every internal claim carries a file path. Nothing here
is implemented.

---

## Part 1 — Pattern survey

### 1.1 Editors: tabs vs tab GROUPS

**VS Code** separates *tabs* from *editor groups*. Groups are the split unit; tabs live
inside one group.

- No documented cap: "You can open as many editor groups as you like side by side
  vertically and horizontally."
  <https://code.visualstudio.com/docs/getstarted/userinterface>
- Grid layouts are first-class commands (`workbench.action.editorLayoutTwoColumns`,
  `…ThreeColumns`, `…TwoByTwoGrid`).
  <https://github.com/microsoft/vscode/blob/994f4db37583f5a9930cfa00d025e686d9ed337f/src/vs/workbench/browser/parts/editor/editorActions.ts>
- `workbench.editor.openSideBySideDirection` (`'right'` default) governs where a split lands.
  <https://github.com/microsoft/vscode/blob/994f4db37583f5a9930cfa00d025e686d9ed337f/src/vs/workbench/browser/parts/editor/workbench.contribution.ts>
- **Focus is explicit and keyboard-addressable**: ⌘1/⌘2/⌘3 jump to the leftmost/centre/
  rightmost group; `workbench.action.focusNextGroup` cycles.
  <https://code.visualstudio.com/docs/getstarted/userinterface>
- **Drag-to-split**: "Create a new editor group by dragging an editor to the side, or by
  using one of the Split commands in the editor tab context menu."
  <https://code.visualstudio.com/docs/configure/custom-layout>
  (The in-drag drop-zone overlay is not described in official docs — unverified.)
- **Dependent context follows the ACTIVE EDITOR, not a group.** The Outline "shows the
  symbol tree of the currently active editor"
  (<https://code.visualstudio.com/docs/getstarted/userinterface>), and the Explorer
  subscribes to `editorService.onDidActiveEditorChange` to reveal the active file
  (<https://github.com/microsoft/vscode/blob/994f4db37583f5a9930cfa00d025e686d9ed337f/src/vs/workbench/contrib/files/browser/views/explorerView.ts>).
  There is exactly one "active editor" across all groups — **this is precisely the model
  the user is asking for.**
- **Narrow handling**: hard floor `DEFAULT_EDITOR_MIN_DIMENSIONS = new Dimension(220, 70)`
  <https://github.com/microsoft/vscode/blob/994f4db37583f5a9930cfa00d025e686d9ed337f/src/vs/workbench/browser/parts/editor/editor.ts>;
  tabs shrink via `workbench.editor.tabSizing` (`fit`/`shrink`/`fixed`, fixed min 38px);
  the minimap can auto-hide (`editor.minimap.autohide`).
- **Preview is per-group**: "a maximum of one preview mode editor per editor group."
  <https://github.com/microsoft/vscode/blob/994f4db37583f5a9930cfa00d025e686d9ed337f/src/vs/workbench/browser/parts/editor/workbench.contribution.ts>
  Directly relevant: our uncommitted preview slot is currently *global*, not per-zone.

**Zed** — panes are workspace children ("Workspaces contain Panes and Panels, and Panes
contain Editors") <https://zed.dev/docs/key-bindings>; splits via `workspace::SplitRight`
<https://github.com/zed-industries/zed/blob/d71f1461045c098dc6ca6b1b5adcf1b8949722e8/crates/zed/src/zed/app_menus.rs>,
with a centered-layout mode carrying `left_padding`/`right_padding`
<https://zed.dev/docs/reference/all-settings>. Notably, **Zed's agent multiplicity is NOT
built on panes** — see §1.3.

**JetBrains** — "Split Right"/"Split Down" from the tab context menu, plus "Split and Move
Right" which moves rather than duplicates
<https://www.jetbrains.com/help/idea/managing-editor-tabs.html>. Project view tracks the
open file via "Always Select Opened File"
<https://www.jetbrains.com/help/idea/project-tool-window.html>; whether it tracks a
*specific split* is not documented (unverified).

### 1.2 Terminal multiplexers: focus is explicit, indication is subtle

- **tmux**: click-to-focus only with mouse mode — "Pressing the left button on a pane will
  make that pane the active pane"; the active pane's border is green;
  `pane-active-border-style` and `focus-events` are configurable.
  <https://github.com/tmux/tmux/wiki/Getting-Started>
  **Focus-follows-mouse is refused by the maintainer**: "It would be possible but I have no
  plans to do it." <https://github.com/tmux/tmux/issues/782>
- **iTerm2**: "Focus Follows Mouse" exists but is **off by default**
  <https://iterm2.com/documentation-preferences-pointer.html>. Its focus cue is *negative
  space*: "split panes that do not have keyboard focus will be slightly dimmed."
  <https://iterm2.com/documentation-preferences-appearance.html>
- **Warp**: splits are per-pane isolated sessions; "the active pane will be marked with a
  triangle in the top corner" <https://docs.warp.dev/terminal/windows/split-panes/>.
  Input is per-pane by default; broadcasting is an opt-in "synchronized inputs" feature
  <https://docs.warp.dev/terminal/entry/synchronized-inputs/>.
- Warp treats **vertical tabs, not splits, as the multi-agent primitive**: "Vertical tabs
  are the foundation of a multi-agent workflow… they show rich metadata for each session"
  (running agent, branch, cwd, status). A setting
  `open_conversation_layout_preference` chooses `"new_tab"` (default) vs `"split_pane"`.
  <https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents/>,
  <https://docs.warp.dev/terminal/settings/all-settings/>

**Takeaway**: three independent terminal products converge on *explicit click/keyboard
focus*, and the most-copied focus indicator is dimming the unfocused pane rather than
outlining the focused one.

### 1.3 AI/agent products: almost everyone is list + one focused transcript

Only **three** products were verified to put two agent transcripts side by side:

| Product | Multi-session presentation | Source |
|---|---|---|
| **Claude Code desktop** | Sidebar list + **opt-in second pane** | <https://code.claude.com/docs/en/desktop> |
| **Cursor Agents Window** | Sidebar list + opt-in **Tiled Layout** | <https://cursor.com/changelog/3-1> |
| **Windsurf Cascade Arena** | Two models, side-by-side only via a manual drag workaround | <https://docs.devin.ai/desktop/cascade/arena> |

Everything else verified is **list/sidebar + one focused transcript**:

- **Zed**: threads are a docked sidebar, not panes — "You can run multiple agent threads at
  once, each working independently with its own agent, context window, and conversation
  history"; `ctrl-tab` cycles them. <https://zed.dev/docs/ai/parallel-agents>,
  <https://zed.dev/docs/ai/agent-panel>
- **Claude Code CLI** — `claude agents` is "one screen for all your background sessions:
  what's running, what needs your input, and what's done", grouped into *Ready for review /
  Needs input / Working / Completed*, with a Haiku one-line summary per row. `Space` peeks;
  `Enter` attaches. <https://code.claude.com/docs/en/agent-view>
- **Cursor default**: "manage every agent from the sidebar and pin the chats you return to
  most so they stay at the top" <https://cursor.com/help/ai-features/multi-agent>; the web
  dashboard is a "Kanban view of Cursor Agents" <https://cursor.com/blog/agent-web>.
- **Windsurf**: "multiple Cascades running simultaneously… navigate between them using the
  dropdown menu" — a switcher, not a split. <https://docs.devin.ai/desktop/cascade/cascade>
- **OpenAI Codex cloud**: a task list (description, repo, status, diff stat); single-task
  detail view. <https://learn.chatgpt.com/docs/cloud>. "You can run multiple threads at
  once, but avoid having two threads modify the same files."
  <https://developers.openai.com/codex/concepts/>
- **GitHub Copilot coding agent**: an agents panel — "monitor and manage agent sessions
  across your repositories"; click a session to open its log.
  <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions>
- **Conductor** (workspace sidebar, worktree per session)
  <https://www.conductor.build/docs/concepts/parallel-agents>; **Vibe Kanban** (kanban board)
  <https://github.com/BloopAI/vibe-kanban>; **Devin MultiDevin** (manager + up to 10 workers,
  per-session Progress tab) <https://docs.devin.ai/work-with-devin/devin-session-tools>.
  None documents a simultaneous multi-transcript view.

**The single most useful precedent** is Claude Code desktop, because it is the only product
with a *documented input-routing rule* for a two-pane chat split:

> "To view two sessions at once, hold Cmd on macOS or Ctrl on Windows and click a session in
> the sidebar. The session opens in a second pane alongside the one you already have open.
> While the split is active, clicking another sidebar session replaces whichever pane has
> focus." — <https://code.claude.com/docs/en/desktop>

`Cmd+\` closes the focused pane back to single-session view. Split is **opt-in via a
modifier**, capped at two, and driven from the *existing* session list rather than a new
docking model.

### 1.4 Focus-driven context switching and attention routing

- **Explicit focus everywhere.** No surveyed product uses focus-follows-mouse for panes by
  default (tmux refuses it; iTerm2 ships it off). No debouncing appears in any doc because
  focus only changes on a deliberate click or keystroke — **avoiding context flapping is a
  consequence of explicit focus, not a separate mechanism.**
- **Attention routing for unfocused sessions**, all primary-sourced:
  - Claude Code desktop: "sends an OS notification when a Code session finishes a task and
    you aren't currently viewing that session." <https://code.claude.com/docs/en/desktop>
  - Claude Code CLI: terminal-channel notification when a background session "starts needing
    your input, finishes, or fails", plus a live `← 2 agents` counter in the prompt footer
    that flashes on change <https://code.claude.com/docs/en/agent-view>; the `Notification`
    hook fires on `permission_prompt` / `idle_prompt`
    <https://code.claude.com/docs/en/hooks-guide>.
  - Cursor mobile: Live Activities tracking up to eight agents; Slack completion pings.
    <https://cursor.com/blog/agent-web>
  - Not verified for Zed / Windsurf / Codex cloud / Copilot / Devin / Antigravity.
- **The pitfall the survey makes concrete**: "you aren't currently viewing that session" is
  the notification predicate. In a split, *two* sessions are being viewed but only one is
  focused — a third state our current unread logic does not have (see §2.4).

---

## Part 2 — Fit and conflict with Mainframe's architecture

### 2.1 The rejection this question re-opens

`docs/plans/2026-08-08-session-tabs-and-workspace-files.md` lines 9–12:

> "**Chrome-style session tabs live in the MainToolbar.** The active session is whichever
> tab is focused. There is ONE chat surface — tabs switch its content. This is the chosen
> answer to multi-session; side-by-side chat is **rejected**, and with it the reason to
> extend the placement algebra."

Pinned again in `packages/ui/CLAUDE.md` line 60: "Multi-session is chrome-style **session
tabs in the MainToolbar** … side-by-side chat is REJECTED. `layout-placement.ts`
deliberately KEEPS the three-slot algebra… Surfaces never exchange tabs."

**What the rejection was protecting** is legible from the same doc: line 27, "no new docking
framework", and line 64, "A split surface keeps per-pane strips and a full-height sidebar
(two strips — there is no one header to extend)." The cost being refused was a *second
`SurfaceId` and a general docking model*, not the idea of two visible transcripts.

That distinction is the whole fit analysis: **a split INSIDE the chat surface — two zones,
one `SurfaceId`, `layout-placement.ts` untouched — honours the rejection's stated cost while
answering the new requirement. A second `SurfaceId` re-litigates it head-on.**
`packages/ui/src/store/layout-placement.ts` hardcodes `SurfaceId = 'chat' | 'workspace'`
(line 13) and a top row of at most two, so adding a chat-B surface would touch
`placeInLayout`, `removeSurface`, `repositionInLayout`, `insertTop`, and the persisted
`mf:session-layout` schema.

### 2.2 The runtime: one global runtime, one `mainThreadId`, one live subscription

- One global aui runtime, mounted once (`packages/ui/CLAUDE.md` line 43).
- Liveness is a **single equality test** in
  `packages/ui/src/features/sessions/runtime/use-chat-runtime-hook.ts` lines 29–31:
  `s.threads.mainThreadId === s.threadListItem.id && s.threadListItem.remoteId != null`.
  Exactly one thread can be live.
- **Controller keep-warm already exists.** `chatControllerRegistry.getOrCreate(chatId, port)`
  keys controllers by stable id, and `subscribeState` keeps every visited controller warm;
  only `subscribeLive` is gated
  (`packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts` lines 6–8, 77, 140).
- **But warm ≠ current.** `packages/ui/src/features/chat/controller/chat-ws-subscription.ts`
  lines 31–40: "switching away tears down the per-chat sub, so a backgrounded chat receives
  NOTHING while dormant even though the daemon keeps persisting messages — the reattach must
  re-seed or the transcript stays stuck at the pre-dormancy snapshot."
  **A second visible zone under today's gating would render a frozen transcript.**

**What 2+ live zones require:**

1. `active` becomes **set membership** over the visible-zone ids instead of equality with
   `mainThreadId` (one predicate, `use-chat-runtime-hook.ts:29`).
2. **Nothing in the daemon.** Verified: the WS handler keeps a per-socket
   `subscriptions: &Arc<Mutex<HashSet<String>>>`; `Subscribe` inserts, `Unsubscribe` removes
   (`packages/core-rs/crates/mainframe-server/src/websocket.rs` lines 426, 431, 465). N
   concurrent chat subscriptions on one socket are natively supported.
3. **Nothing in event routing.** Each controller registers its own `ws.onEvent` handler and
   filters by `chatId` (`packages/ui/src/features/chat/controller/chat-event-router.ts`
   lines 32–67), so concurrent subscriptions do not cross-talk.
4. **Promote/demote is already safe.** The reattach re-seed
   (`isReattach()` → `onSubscribeRefresh()`, `chat-ws-subscription.ts` lines 50, 133) exists
   precisely to catch a chat up after dormancy.
5. **Rendering a non-main thread is the one unverified hinge.**
   `ThreadListItemRuntimeProvider` and `ThreadListItemByIndexProvider` *are* exported by the
   pinned `@assistant-ui/react@0.15.13`
   (`node_modules/@assistant-ui/react/dist/index.d.ts` line 5), and `ChatThread` renders a
   single `ThreadPrimitive.Root`
   (`packages/ui/src/features/chat/thread/ChatThread.tsx` line 135). Whether a **visible**
   `ThreadPrimitive` tree mounted under that provider renders the non-main thread's messages
   and composer is **not verified** — it is the first spike any 2-live-zone candidate must
   run, before any other work.

### 2.3 Focused-zone context: the cheap rewiring is `switchToThread`

`useActiveIdentity` (`packages/ui/src/features/sessions/use-active-identity.ts` lines 45–47)
reads `s.threadListItem` / `s.threads` straight from aui. It has **33 non-test consumer
files**, including `use-todos-store.ts`, `TasksCard.tsx`, `SummarySection.tsx`,
`LaunchCard.tsx`, `SessionPanelRail.tsx`, `PlanSection.tsx`, `WorkspaceSurface.tsx`,
`ReviewPanel.tsx`, and the whole editor/preview/url-tab/automations cluster.
`useActiveBasesStore` adds 9 more.

**If focusing a zone calls `aui.threads.switchToThread(id)`, all 33 follow focus for free —
zero consumer files change.** Focus and liveness become independent axes: `mainThreadId`
means "focused", set membership means "live". This is exactly VS Code's model (one active
editor across N groups, §1.1).

Two caveats to check before relying on it:

- **`switchToThread` has side effects.** `use-session-list-router.ts` clears unread on every
  `mainThreadId` change (lines 193–198) and maintains an `activeChatIdsRef` used to suppress
  unread for the active chat (lines 74–80, 113). Under a split, the **unfocused-but-visible**
  zone would keep accruing unread badges for messages the user can see — `activeChatIdsRef`
  must widen to the visible-zone set. This is the concrete form of the §1.4 pitfall.
- **A zone needs a `remoteId`.** Liveness requires it (`use-chat-runtime-hook.ts:30`), so an
  unsent draft cannot be a second zone.

Fallback if `switchToThread`-per-click proves too noisy: a separate focused-zone store, with
`useActiveIdentity` internals rewired to read it — one file changes, but the store must then
be threaded to every non-aui reader.

### 2.4 Width math — the headline constraint

Constants, all from `packages/ui/src/features/session-panel/panel-mode.ts`:
transcript `max-w-3xl` = **768** (line 22); `PANEL_BLOCK_WIDTH` = 8+288+12+42 = **350**
(line 44); `INLINE_MIN_WIDTH` = 768 + 2×350 = **1468** (line 47); rail alone = 42+12 =
**54** (lines 28–30). Sidebar default = **256**
(`packages/ui/src/store/ui-prefs.ts` line 15). Add ~6px for the `SurfDivider` gutter.

**Window width required for two side-by-side zones:**

| Configuration | Chat row | + sidebar 256 | Verdict |
|---|---|---|---|
| Both zones, panel stack **inline** | 2936 | **~3198** | Impossible on any real display |
| Focused zone inline, other rail-only | 2290 | **~2552** | Only a 27" 5K at default scaling |
| Both zones rail, full 768 transcript | 1644 | **~1906** | Large external display |
| Both zones rail, sidebar hidden | 1644 | **~1650** | Fits a 16" MBP |

**Reverse direction — what you actually get** (sidebar visible, 6px divider; logical widths
are Apple's default scaled modes, not re-verified against a fetched source this run):

| Display | Logical width | Per zone | Transcript per zone | Panel mode |
|---|---|---|---|---|
| 14" MacBook Pro | 1512 | 625 | **571** (74% of 768) | rail/overlay |
| 16" MacBook Pro | 1728 | 733 | **679** (88%) | rail/overlay |
| 27" 5K, default | 2560 | 1149 | 768 (capped) | **still rail** — 319 short of 1468 |

**Two consequences, both load-bearing:**

1. **In split mode the session panel is permanently rail-or-overlay.** `derivePanelMode`
   returns `inline` only at ≥1468 per host row (`panel-mode.ts` lines 62–68); no zone on any
   realistic display clears it. The panel stack — the current design's primary session-context
   surface, per the 2026-08-11 verdict in memory — becomes an overlay that borrows the
   transcript. The rail itself is fine: it "has no minimum width and renders in every
   measured state" (`panel-mode.ts` lines 16–18).
2. **A readability floor must be chosen and enforced.** VS Code's hard floor is
   `Dimension(220, 70)` for *code*
   (<https://github.com/microsoft/vscode/blob/994f4db37583f5a9930cfa00d025e686d9ed337f/src/vs/workbench/browser/parts/editor/editor.ts>);
   prose needs far more. At 571px the 14" transcript still holds ~75 characters at our
   `px-5` inset — usable, but tool cards, diffs, and code blocks are the risk, not paragraphs.

### 2.5 Tab strip and the uncommitted preview slot

`packages/ui/src/features/session-tabs/store.ts` is now editor-style: an ordered pinned set
plus **one global preview slot** (lines 1–5, 16–17). VS Code's preview is **per editor
group**. A split therefore forces a decision: one preview slot for the window (a preview
opened in zone B evicts zone A's preview) or one per zone (`previewId` becomes a per-zone
field, and `reconcilePreviewId` — `tabs-model.ts` lines 148–157 — is called per zone).

Also note `tabs-model.ts` lines 103–121: a session has two aui identities during the
local→remote handoff, and `canonicalTabId` collapses them. Any zone→tab mapping must go
through that helper, not raw ids.

---

## Part 3 — Candidate models

### Candidate A — Editor-style split groups, each with its own tab strip

Two (or N) chat groups, each owning an independent pinned/preview tab set; drag a tab to an
edge to split; `⌘1`/`⌘2` focus a group.

- **Focus**: explicit click or keybinding; focused group gets the border, unfocused dims
  (iTerm2 model, §1.2).
- **Tab strip**: the MainToolbar strip splits into per-group strips — exactly the shape the
  2026-08-08 plan called out as the reason not to do this (line 64: "two strips — there is no
  one header to extend").
- **Width**: worst case; two strips plus two rails, no room for the panel inline ever.
- **WS/controller**: liveness = set membership over all group heads; N subs.
- **Weight**: **heaviest.** New per-group tab-set model (the current store is a flat set),
  per-group preview reconcile, drop-zone drag layer, group persistence in `mf:session-tabs`,
  and a directly re-litigated architectural verdict.

### Candidate B — Two-pane compare mode driven from the existing single tab strip

One tab strip stays in the MainToolbar. A modifier-click (or a "Open in split" action) on a
tab or sidebar row opens that session in a **second zone**. Max two zones. Clicking any tab
replaces the **focused** zone. An explicit close (`⌘\`) returns to one zone.

- **Focus**: explicit click anywhere in a zone, or a keybinding; focus sets
  `mainThreadId` via `switchToThread`, so all 33 `useActiveIdentity` consumers follow for
  free (§2.3). Focused zone outlined, unfocused dimmed.
- **Tab strip**: unchanged shape. Both zones' tabs light in the one strip (focused = solid,
  co-visible = subdued) — a third tab state, not a second strip.
- **Width**: 2 zones + rails, sidebar hidden ≈ **1650**; with sidebar ≈ **1906**. Both
  zones permanently in rail/overlay panel mode (§2.4). Enforce a minimum window width or a
  clamp.
- **WS/controller**: `active` becomes membership in a 1-or-2 element set
  (`use-chat-runtime-hook.ts:29`); daemon unchanged (§2.2); `activeChatIdsRef` widens to the
  visible set (§2.3).
- **Weight**: **lightest of the three that actually deliver 2 live transcripts.** A zone
  store (≤80 lines), the liveness predicate change, the second `ChatThread` mount under a
  per-thread provider (the §2.2 spike), the unread-set widening, and a preview-slot decision.
  `layout-placement.ts` and the surface model are untouched.

### Candidate C — Dashboard/grid of read-mostly sessions, one focused composer

A grid of compact session cards (status, last message, token/permission state), with the
focused one expanded to a full transcript + composer. Closest to `claude agents` (§1.3) and
Cursor's Kanban.

- **Focus**: click a card to focus; only the focused card carries a composer.
- **Tab strip**: unaffected — the grid is a *mode*, not a layout change.
- **Width**: best. Cards can be 300–400px; only the focused zone needs 768+54.
- **WS/controller**: **worst.** A useful card needs live status, so either N live subs (fine
  per §2.2, but N grows with session count) or a new lightweight status stream. Card content
  would want a summary the daemon does not produce today — note Claude Code generates a
  per-row summary with Haiku (<https://code.claude.com/docs/en/agent-view>).
- **Weight**: **medium-to-heavy**, and it answers a *different* question. It solves
  "monitor many sessions"; the user asked for "read two transcripts at once."

---

## Recommendation

Build **Candidate B**: a capped two-zone compare mode driven from the existing single tab
strip, with focus as an explicit click that calls `switchToThread` so `mainThreadId` keeps
its meaning as "the focused zone" and all 33 `useActiveIdentity` consumers follow context for
free. This is the only candidate that delivers two live transcripts without giving up what
the 2026-08-08 rejection was actually protecting: that verdict refused a second `SurfaceId`,
per-pane tab strips, and "a new docking framework" (plan lines 27, 64) — not the idea of two
visible chats. Candidate B leaves `layout-placement.ts`, the two-surface model, and the
single tab strip intact; the split lives *inside* the chat surface as a zone split, so the
placement algebra is never extended. It is also the shape the strongest external precedent
converged on: Claude Code desktop caps the split at two, opens it with a modifier-click from
the existing session list, and routes input to the focused pane, with the explicit rule that
"clicking another sidebar session replaces whichever pane has focus"
(<https://code.claude.com/docs/en/desktop>) — a rule worth adopting verbatim. Two costs must
be accepted up front rather than discovered later: the session panel can never be inline in a
split on any real display (§2.4), so the rail and overlay become the split-mode panel
experience; and the whole model rests on one unverified hinge — that a visible
`ThreadPrimitive` tree under `ThreadListItemRuntimeProvider` renders a non-main thread — which
must be spiked before anything else is built.

---

## Open decisions for the user

1. **Minimum window width to allow a split.** Deny the split below a threshold, or allow it
   and let the transcript degrade to ~571px (14" MBP)? If deny, what happens to an open split
   when the window is resized below it — collapse to one zone, or clamp?
2. **Session panel in split mode.** Rail on *both* zones, or rail on the focused zone only
   (saves 54px and removes an ambiguous second rail)? Overlay-open behaviour when the
   unfocused zone's rail is clicked — does clicking it also focus that zone?
3. **Workspace-surface coexistence.** Sidebar 256 + two chat zones + a workspace surface does
   not fit a laptop. Auto-hide the sidebar on split? Make split and a two-surface top row
   mutually exclusive? Or allow it and accept ~400px zones?
4. **The unfocused zone's composer.** Full composer (type into either zone, click-to-focus
   first) or read-mostly with the composer only on the focused zone (Candidate C's rule)?
   This is the input-routing decision and it should be explicit.
5. **Tab-strip presentation while split.** Does the co-visible-but-unfocused zone's tab get a
   distinct third state? And does the **preview slot** stay global (zone B's preview evicts
   zone A's) or become per-zone, as VS Code's is
   (<https://github.com/microsoft/vscode/blob/994f4db37583f5a9930cfa00d025e686d9ed337f/src/vs/workbench/browser/parts/editor/workbench.contribution.ts>)?
   This interacts directly with the uncommitted `session-tabs/store.ts` work.
6. **Attention routing for a visible-but-unfocused zone.** Today unread clears on
   `mainThreadId` change only (`use-session-list-router.ts` lines 193–198). Should a visible
   unfocused zone count as read (user can see it), or keep badging? Claude Code desktop's
   predicate is "you aren't currently viewing that session"
   (<https://code.claude.com/docs/en/desktop>), which reads as visible = viewed.
7. **Zone cap.** Hard cap at two (Claude Code desktop's choice), or allow N and let width
   arbitrate (Cursor's Tiled Layout)?
8. **Split persistence.** Does an open split survive a reload — a second entry in
   `mf:session-tabs`, or is split always transient?
