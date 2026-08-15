# E2E Flow Map — All Untested Surfaces

_Generated 2026-08-11 by reading the renderer components and handlers, anchored on the test-id gap
list in [`UNUSED-TESTIDS.md`](./UNUSED-TESTIDS.md). These are the **edges** (sequences,
preconditions, conditional rendering) that test-ids alone don't encode — the input for the
`test-scenarios` skill and for authoring specs._

Priority key: **P0** critical user path · **P1** important · **P2** edge/secondary.

---

## Sessions list & filters

_Specs: `sessions.spec.ts`, `sessions-rows.spec.ts`, `sessions-filters.spec.ts`,
`sessions-tags.spec.ts`, `sessions-draft.spec.ts`. This surface has the deepest existing coverage in
the suite — the rows below are the preconditions and edges worth keeping in view, not gaps._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| SL1 | New session — filtered vs. "All" | P0 | sidebar loaded | sessions-new-button, sessions-new-picker, sessions-new-picker-project-${…} | a project filter active skips the picker and opens the draft directly; "All" view opens a menu; re-clicking retargets the one reused draft rather than stacking a second |
| SL2 | Select / switch row | P0 | ≥1 session | sessions-row, sessions-row-title | click sets `data-active`; row action buttons stopPropagation so clicking Pin/Tag/Archive doesn't switch the session |
| SL3 | Row hover actions vs. context menu | P1 | ≥1 session | sessions-row-action-pin, sessions-row-action-tags, sessions-row-action-archive, sessions-ctx-pin, sessions-ctx-rename, sessions-ctx-tags, sessions-ctx-archive, sessions-ctx-copy-id | hover reveals a subset (pin/tag/archive) in front of the relative time; right-click adds Rename and Copy Session ID; copy-id only shown once a `claudeSessionId` exists |
| SL4 | Rename | P1 | ≥1 session | sessions-rename-input | Enter commits, Esc cancels; input is the row title swapped in place |
| SL5 | Archive with worktree | P1 | chat has a worktree | sessions-archive-cancel, sessions-archive-confirm-dialog, sessions-archive-keep-worktree, sessions-archive-delete-worktree | only a chat with an attached worktree prompts keep-vs-delete; deleting removes the directory from disk |
| SL6 | View / restore archived | P1 | ≥1 archived | sessions-archived-dialog, restore-session-btn | scoped to the active project filter |
| SL7 | Project filter switcher | P0 | ≥1 project | sidebar-project-, sidebar-project-all, sidebar-project-badge-${…} | single-select, not a toggle — re-clicking the already-active row is a no-op; switching projects re-narrows the list but leaves the active session alone if it survives the new filter |
| SL8 | Project switcher overflow | P2 | >5 projects | sidebar-project-more | "Show N more" / "Show less" toggle past the fifth row |
| SL9 | Tag filter bar | P1 | ≥1 tag applied to a session | sessions-tag-filter-bar, sessions-tag-filter-${…}, sessions-tag-filter-synthetic-${…} | bar is absent until a tag is in use; synthetic `has-pr`/`has-worktree` chips appear once a session carries one; toggling multiple chips AND-filters |
| SL10 | Sort menu | P1 | ≥1 session | sessions-sort-button, sessions-sort-popover | switching sort mode changes which group label is "parked" (Pinned/Today/Yesterday/Earlier vs. per-project) |
| SL11 | Tag create / rename / recolor / delete | P1 | tag popover open (from row hover action or context menu) | sessions-tag-popover, sessions-tag-popover-create, sessions-tag-popover-search, sessions-tag-registry-rename, sessions-tag-recolor-panel, sessions-tag-registry-delete, sessions-tag-delete-confirm-ok | create is type + Enter, applies immediately; rename cascades to every row wearing the tag; delete needs the two-step confirm dialog; disallowed names show an inline validation message and suppress create |
| SL12 | Remove project | P1 | right-click a project row | sidebar-project-remove-menu-${…} | Rename is disabled from this menu (rename lives elsewhere); Remove needs confirm and shows a toast |
| SL13 | Draft session lifecycle | P0 | new draft opened, not yet sent | sessions-draft-row, sessions-draft-row-title, sessions-draft-row-discard | draft resolves a project without creating a chat; composer config selectors (model/adapter/permission) are usable pre-send; the chat is created on the **first send only**, exactly one; discarding (✕) clears the row and restores the previously active session |
| SL14 | Draft suggestions | P2 | project has git history | sessions-welcome-suggestion-${…}, sessions-welcome-suggestion-insert-${…} | row count matches the daemon response; clicking one inserts its exact prefill text into the composer |
| SL15 | Import external sessions | P1 | external CLI sessions exist for the project | sessions-import-dialog, sessions-import-project-${…}, sessions-import-back, sessions-import-load-more, sessions-import-retry | import button is disabled with no external sessions; dialog opens paginated (windowed) and pages in more on scroll-to-end, retiring the sentinel; import does not switch the active chat; a failed fetch shows an error state with retry |
| SL16 | Zero-project / zero-session boot | P0 | fresh workspace, no projects | sessions-firstrun, sessions-firstrun-add-project | shows the FirstRunState hero instead of the project picker or a projectless dead-end surface |
| SL17 | Worktree-missing warning | P1 | chat's worktree path no longer exists on disk | sessions-row-meta-worktree | the row's worktree glyph flips to a warning, the status dot to worktree-missing, and the hover card (`SessionMetaCard`) surfaces the warning text |
| SL18 | Unread marking | P1 | a response lands while a different chat is active | — | row marks unread; clears on reselect |

## ★ Session panel

_Spec: `session-panel.spec.ts` — the widest and most detailed of the new-surface suites. Rows below
capture the sizing/mode state machine the spec exercises._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| SP1 | Three display modes | P0 | chat active | session-panel-root, session-panel, session-panel-overlay, session-panel-rail | `inline` (wide surface, card sits beside the transcript), `overlay` (a rail click floats the card over the thread; Escape or an outside pointer dismisses it), `rail`-only (surface too narrow, or the gutter can't even hold the rail — then nothing renders); narrowing/widening the surface transitions between them live |
| SP2 | Rail → card focus return | P1 | overlay dismissed by keyboard | session-panel-rail-open, -activity, -launch | when a floating card goes away with focus still inside it, focus returns to the rail button that opened it — but only if nothing else claimed focus in the meantime |
| SP3 | Rail button re-targeting | P1 | rail visible | session-panel-rail-open, -activity, -context | every rail button routes through `selectSection`, which both expands the target section and brings the card back (inline if the gutter holds it, floating otherwise) |
| SP4 | Summary — no collapse trigger | P0 | panel open | session-panel-section-summary | Summary is always expanded and carries no collapse header, unlike every other section |
| SP5 | Background Activity | P1 | panel open | session-panel-section-toggle-activity | starts collapsed; the rail button expands it straight to its empty state if nothing is running |
| SP6 | Launch section | P1 | ≥1 launch config | session-panel-launch-row-${…}, session-panel-launch-spinner-${…} | lists every config with a start glyph, no live rows when nothing is running |
| SP7 | Rail launch quick action | P0 | a launch config is targetable | session-panel-rail-launch | one click runs/stops via `deriveLaunchRunControl`; disabled ("No launch configs") when nothing is targetable or `chatId` is missing; right-click opens the Launch section instead of firing the action |
| SP8 | Plan section collapse | P1 | todos exist on the session | session-panel-plan, session-panel-plan-toggle, session-panel-plan-step-${…} | section is hidden until todos exist; expanding reveals steps with the in-progress one showing its `activeForm`; collapsing hides steps but keeps the header and progress bar |
| SP9 | Context section sub-groups | P0 | panel open | session-panel-context-file-${…}, session-panel-skill-${…} | expanded by default; a Session sub-group lists in-session file mentions (each with an `@` badge, opens as a workspace editor tab on click); a Skills sub-group shows its own empty state with Manage still reachable |
| SP10 | Attachment tiles | P1 | ≥1 attachment | session-panel-attachment-${…}, session-panel-attachment-grid | image tiles open the lightbox; non-image tiles do not |
| SP11 | Summary branch/changes/context rows | P0 | chat active | session-panel-summary-branch-wt | branch row names the live branch, no worktree badge unless a worktree is attached; changes row shows +/- totals with the file count on the tooltip only; context row is absent before the first turn and reports a real percentage after one; clicking the changes row opens the review modal |

## ★ Session tabs

_Spec: `session-tabs.spec.ts`. Chrome-style tabs in the `MainToolbar` — the active session is
whichever tab is focused; there is one chat surface._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| ST1 | Membership sync | P0 | any thread activation (sidebar click, palette, toast deep-link, boot auto-select, archived-active fallback) | session-tab-${…} | `useSessionTabsSync` inserts a tab for whatever thread becomes active, covering every activation path through one seam rather than each call site |
| ST2 | Close tab | P0 | ≥1 tab open | session-tab-close-${…} | closing removes from the open set only — it never archives the session; closing the active tab picks the next tab via `nextActiveAfterClose`; closing the last tab falls back to the new-session flow (same as sidebar "+" / ⌘N) |
| ST3 | New session from strip | P0 | any state | session-tabs-new | same handler as the sidebar "+" and ⌘N |
| ST4 | Persistence + pruning | P1 | app reload with open tabs | — (localStorage `mf:session-tabs`) | restores once a real session list load settles carrying ≥1 session, merging with tabs the boot already opened; prunes tabs whose thread vanished; a still-loading or failed list leaves the persisted payload untouched for a later real load |
| ST5 | Overflow | P2 | tab row wider than available space | — | pills shrink from `w-45` to `min-w-24`, then the row scrolls horizontally with no visible scrollbar |

## ★ Workspace surface + floating Files panel

_Specs: `workspace-surface.spec.ts`, `files-tree.spec.ts`, `layout.spec.ts`. The Files tree is a
floating glass panel over the workspace surface — the session panel's pattern mirrored on the other
side._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| WS1 | Empty vs. populated surface | P0 | workspace surface lit | workspace-surface, workspace-empty-state, workspace-pane-${…} | with no tabs, shows a header (split/close controls stay reachable even with nothing open) plus the empty-state picker card; the `+`/add affordance lives only in the empty state, not repeated in the header |
| WS2 | Empty-state picker rows | P1 | workspace empty | workspace-picker-open-file, workspace-picker-view-changes, workspace-picker-recent-${…}, workspace-picker-open-url, workspace-picker-new-terminal, workspace-picker-launch-${…} | recent-file rows and launch-config rows are data-driven, present only when there's something to list |
| WS3 | Files panel toggle | P0 | workspace surface lit | workspace-files-open, workspace-files-panel | strip button toggles the floating panel; `aria-pressed` mirrors open state; Escape or a pointer outside (portal- and trigger-aware) light-dismisses; hidden, not unmounted, when closed — expanded folders and scroll position survive a dismiss |
| WS4 | Files panel — no project | P1 | no active project/chat | workspace-files-panel | shows "Open a session to browse its files." instead of a tree |
| WS5 | File tree browse | P0 | project active | files-tree-node (via `FileTree`) | expand/collapse lazily fetches children; clicking a file opens it as a workspace editor tab and closes the panel (`onCollapse`) |
| WS6 | Scope-filtered tabs | P0 | active session has a launch scope (project + worktree) | — | the surface renders only tabs matching the active session's `scopeKey`; a tab opened under another project/worktree does not leak in; legacy tabs predating per-tab scope keys fall back to the first scope with statuses for the active project |
| WS7 | Add-tab menu | P1 | a pane exists | workspace-tab-strip-add-${…}, workspace-add-menu-${…}, workspace-pane-open-file-${…}, workspace-pane-new-terminal-${…}, workspace-pane-open-url-${…}, workspace-pane-launch-${…} | one menu per pane; launch entries are per-config |
| WS8 | Split / un-split | P0 | workspace has content | workspace-surface-drag, workspace-surface-close, workspace-pane-close-${…} | split controls live on the chat header, not the workspace strip — the strip only renders while the workspace is already placed, which is exactly when a split can't be triggered from here; primary-pane close is disabled at the dynamic floor (whichever surface is the sole lit one); a secondary pane's close un-splits without hiding the primary |
| WS9 | Tab drag between panes | P1 | 2 panes | data-drop-surface="workspace" | dragging a tab onto an edge splits into a second pane; dragging back to center rejoins and un-splits; Escape cancels a drag mid-gesture, pane count unchanged |
| WS10 | Layout persistence per session | P0 | layout arranged, switch sessions | — (`mf:session-layout` v2) | arranging a layout in session A does not leak into session B; A's arrangement is restored on return |
| WS11 | Hide vs. close | P1 | a file open in a pane | — | `toggleSurface('workspace')` hides but preserves panes and tabs; the terminal cache detaches without disposing; kill-before-remove and tunnel release only happen on the real close paths (`closeRunTab`, `closePane`, `releaseRunScope`) |
| WS12 | File picker (tab-strip add) | P1 | pane exists | dir-picker / file-picker (via `FilePickerDialog`) | opens from the add button with a search hint; arrow-key navigation; Enter opens the selected file; unmatched query shows a no-match empty state |

## ★ Spotlight / command palette

_Spec: `spotlight.spec.ts` — thoroughly covered end to end already; rows note the mode grammar for
future edge cases._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| SPL1 | Open / close | P0 | app running | search-palette | ⌘O opens; Esc closes; the `main-toolbar-search` button also opens it |
| SPL2 | Mode grammar | P0 | palette open | search-palette-mode-chip | prefix-driven: no prefix → files + sessions, `>` → commands, `@` → symbols, `#` → working-tree changes; the mode chip renders once a prefix is typed |
| SPL3 | Default mode, empty query | P1 | palette open, no query | — | lists recent sessions |
| SPL4 | Result selection | P0 | rows present | search-palette-input | controlled selection: cmdk's own select-first-on-search tick runs before rows land async, so the effect re-selects the first row once results arrive if the prior selection no longer exists |
| SPL5 | `@` symbol mode | P2 | a running LSP server for the file's language | — | opens the file at the symbol's line; without a running LSP server the row never resolves |
| SPL6 | Empty state | P1 | query with no matches | search-palette-empty vs. search-palette-loading | loading and empty are distinct testids on the same `CommandEmpty` slot |

## ★ Gates (permission / plan / question)

_Spec: `gates.spec.ts` + the interactive-card assertions inside `chat.spec.ts`. Routing lives in
`ChatGateMount`, dispatched by `ControlRequest.toolName`; only one gate is mounted at a time, pinned in
the thread's sticky footer above the composer (`chat-thread-gate-slot`)._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| G1 | Permission — allow once / deny | P0 | CLI `can_use_tool` for a non-question/non-plan tool | chat-permission-gate, chat-permission-allow-once, chat-permission-deny | allow-once sends no `updatedPermissions`, so the same tool re-prompts next time; an answered gate simply unmounts — the daemon shifts the pending permission so the delivery re-read finds nothing to restore |
| G2 | Permission — always allow | P1 | `request.suggestions.length > 0` | chat-permission-always-allow | **button is absent when suggestions are empty** — test both states |
| G3 | Permission details | P1 | permission gate showing | chat-permission-details-toggle, chat-permission-details-pre | toggles a raw-input JSON dump; the card width matches the composer at both narrow and wide surface widths |
| G4 | Plan — approve | P0 | chat in plan mode; CLI calls `ExitPlanMode` | chat-plan-gate, chat-plan-approve, chat-plan-execmode-${…}, chat-plan-clear-context | exec-mode `yolo` → bypassPermissions; `clearContext` wipes history and restarts the CLI; the approved plan renders as a durable PlanBubble in the transcript, not this card |
| G5 | Plan — reject vs. keep-planning | P0 | plan gate showing | chat-plan-reject, chat-plan-keep-planning | reject is a bare deny with no message; "Keep planning" (not "revise" — renamed from the pre-v2 label) opens the feedback row inline on the same card |
| G6 | Plan — revise loop | P1 | "Keep planning" clicked | chat-plan-feedback-input, chat-plan-send-feedback, chat-plan-revise-cancel | send disabled until feedback is non-empty; sending triggers a new plan gate; the first PlanCard is left resultless in the transcript |
| G7 | Question — single-select | P0 | AskUserQuestion, 1 question, `multiSelect:false` | chat-question-gate, chat-question-option-${…}, chat-question-submit | submit disabled until a pick; selecting replaces the prior selection |
| G8 | Question — multi-select | P1 | `multiSelect:true` | chat-question-option-${…} | toggling adds/removes; submit enables once ≥1 option is selected |
| G9 | Question — "other" free text | P1 | any question | chat-question-other-input-${…} | revealed by selecting the "Other…" option; deselecting hides the input again |
| G10 | Question — multi-question nav | P1 | `questions.length > 1` | chat-question-next, chat-question-back, chat-question-submit | Back is absent on question 1; Next/Submit swap on the last question; a "N of M" counter renders only when there's more than one question; selections persist across navigation |
| G11 | Question — skip | P1 | any | chat-question-skip | answers the whole request with `undefined`, discarding all selections, regardless of which question is active |
| G12 | Queue ordering | P0 | ≥2 pending gates from the same turn | — | queue-front-only rendering: tool 1's gate resolves before tool 2's ever mounts, in the order the daemon queued them |

## Chat transcript, card header & tool cards

_Specs: `chat.spec.ts`, `chat-header.spec.ts`, `transcript.spec.ts`, `tool-cards.spec.ts` — all four
have deep existing coverage; rows below are the conditional-rendering edges worth keeping visible._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| CH1 | Card header — split controls | P0 | chat surface active | chat-header-split-right, chat-header-split-down | rendered only while `layoutCanSplit` — i.e. only while the workspace is not already placed; split-right puts the workspace beside chat in the top row, split-down docks it in the bottom strip |
| CH2 | Card header — hide | P0 | chat active | chat-header-hide | disabled while chat is the dynamic floor (the sole lit surface); enabled once another surface (e.g. Files, via ⌘/Ctrl+2) is lit, and hides the chat surface on click |
| CH3 | Card header — drag grip | P1 | chat active | chat-header-grip | emits a `begin-surface-drag` intent (surface reposition), distinct from the row's own `data-drag-region` OS window-drag handling |
| CH4 | Card header — draft vs. real | P1 | `__LOCALID_*` draft thread | chat-header, chat-header-project | draft header shows a fixed "New Session" title and only the project chip — no model chip, no split/hide controls, since that state doesn't exist until the chat is created on first send |
| CH5 | Message action bar | P1 | assistant message rendered | chat-message-copy, chat-message-export, chat-message-timestamp, chat-message-timing | copy sets a transient copied state; export produces Markdown; the timing pill shows total duration on hover |
| CH6 | Read more / less | P1 | user message >600 chars | chat-user-readmore-toggle | absent at ≤600 chars; the threshold counts node text, not rendered pixels |
| CH7 | Find in thread | P0 | chat with messages | find-bar (via thread-find-input/-next/-prev/-close) | ⌘F; debounced search; wraps at the ends; next/prev disabled at 0 matches; only user + assistant text is indexed |
| CH8 | Scroll to bottom | P1 | scrolled up in a long thread | chat-scroll-to-bottom | appears on scroll-up, returns to the tail on click |
| CH9 | Compaction pill | P2 | a compaction event occurred | chat-compaction-pill | system message renders the pill after compaction |
| CH10 | Degraded chat | P1 | chat's worktree/project root is gone | chat-degraded-card, chat-degraded-continue, chat-degraded-recreate-worktree, chat-degraded-delete | recovery card replaces the composer; distinct actions for continuing without the worktree, recreating it, or deleting the chat |
| CH11 | Tool card expand — generic | P0 | non-special tool call, result defined | chat-tool-group, chat-tool-group-toggle | consecutive explore-family tool calls collapse under one `ToolGroup` header; a tool name absent from the registry falls through to the generic `ToolFallback` card |
| CH12 | Bash card | P0 | Bash tool call | chat-bash-card, chat-bash-trigger, chat-bash-output | collapsed by default; expanding reveals colorized output; exit-code coloring on the exit line, error border on a failed call |
| CH13 | Edit card | P0 | Edit tool call | chat-edit-card, chat-edit-open-diff | open by default with +/- stat pills and the diff body visible; "Open in diff editor" opens a workspace diff tab seeded with the tool's original/modified sides |
| CH14 | Task / subagent group | P0 | `_TaskGroup` or `Task`/`Agent` tool | chat-task-card, chat-task-agent | collapsed by default with agent name/description; expanding renders the nested subagent transcript recursively |
| CH15 | Skill card | P1 | `Skill` tool call / `skill_loaded` child | chat-skill-loaded-pill | a top-level `Skill` call renders as a non-expandable slash-command row; `skill_loaded` inside a TaskGroup renders an expandable system pill |
| CH16 | File-path pill context menu | P1 | assistant content with a file-path pill (Read/Edit/Write cards) | tool-card-path-copy-absolute, tool-card-path-copy-relative | right-click on the pill shows exactly the two copy actions; right-click elsewhere in the message shows no menu at all |
| CH17 | Truncated tool result | P1 | server-truncated result | tool-result-expand-toggle | "Show full output" triggers an async fetch of the full result; failure shows "no longer available" |
| CH18 | PR chip | P2 | daemon detects a PR for the chat | — (session panel Summary, not the header — header PR pills were retired with the session-tabs rework) | see Session panel SP11 |

## Composer

_Specs: `composer.spec.ts`, `composer-advanced.spec.ts` — comprehensive; rows below are the
preconditions that make a row's disabled/hidden state easy to get wrong in a new spec._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| M1 | Send | P0 | not running, worktree present | chat-composer-input, composer-prompt-highlight | send disabled when empty and no attachments/captures; Shift+Enter inserts a newline; a missing worktree disables the input |
| M2 | Provider row lock | P0 | first message not yet sent | composer-provider-footer, composer-model-select | unlocked and reachable before the first send; locks (Locked copy, disabled pills) once the provider row's first message has gone out |
| M3 | Model / effort tuning | P1 | model selected | composer-model-select, composer-model-group-header-${…} | the effort flyout's option set is per-model (a haiku-tier model exposes no flyout at all; a sonnet-tier model offers `max` but not `xhigh`; an opus-tier model exposes all three); enabling "ultracode" pins the effort to `xhigh` and freezes the levels |
| M4 | Permission-mode select | P1 | any | composer-permission-mode-select | switching to Unattended (yolo) is visually distinct (renders red) |
| M5 | Worktree — new branch | P1 | git project, no active worktree | composer-worktree-branch-name, composer-worktree-enable | name validated client-side inline; invalid names disable Enable; mid-session (chat already has messages) shows a warning that the session pauses and resumes |
| M6 | Worktree — existing tab | P1 | git project, existing worktrees | composer-worktree-tab-existing | lists pre-existing project worktrees; Enable creates a new one and reopening the popover shows the active-info readout |
| M7 | Queue while running | P1 | agent running | composer-attachments (queued row) | sending while running queues at the thread tail; editing a queued message and saving (⌘/Ctrl+Enter) updates its content; a second queued message gets FIFO position 2; the queue is consumed by the CLI once the run ends |
| M8 | @ mention popover | P1 | composer focused | composer-add-mention | typing `@` opens the file-mention popover; picking a directory keeps the token open for drill-down (vs. a file, which closes it); Escape closes without clearing the typed text; ARIA combobox wiring (`aria-controls`) resolves to the portalled listbox |
| M9 | / skill popover | P1 | composer focused, project has skills | composer-trigger-popover | picking a skill inserts the literal `/skill` token, not a directive chip |
| M10 | Quote from selection | P1 | assistant text selected | composer-quote-preview, composer-quote-dismiss | selecting text shows a floating selection toolbar; clicking Quote adds a preview pill above the composer; dismissing clears it |
| M11 | Attach / dropzone | P1 | composer not in error state | composer-add-attachment, composer-dropzone, composer-attachment-tile | attaching an image shows a thumbnail; removing clears it; oversize attachments (>5MB) show an error banner |

## Editor, diff & review

_Specs: `editor.spec.ts`, `editor-diff.spec.ts`, `editor-comments-review.spec.ts`,
`review-panel.spec.ts` — thorough; a couple of edges worth naming explicitly._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| ED1 | Diff navigation | P0 | diff open, >1 hunk | diff-next-change, diff-prev-change | both disabled when `changeCount === 0`; scroll a far-apart chunk into view |
| ED2 | Reveal in tree | P1 | diff tab ready | diff-reveal | `DiffHeader` always receives a `filePath`, so the button mounts as soon as the tab is ready, not after an async resolve |
| ED3 | Disk-change banner | P0 | dirty editor file, `file:changed` event | editor-tab-disk-conflict, editor-tab-reload, editor-tab-keep-mine | reload discards local edits; keep-mine preserves them; a non-dirty file reloads silently with no banner |
| ED4 | Save-error banner | P1 | save fails | editor-tab-save-error | persists until the next successful save or the tab closes |
| ED5 | Inline comment lifecycle | P0 | editor with `onLineComment`, gutter line clicked | editor-comment-widget, editor-comment-widget-save | Cancel and Escape both close without saving, but the typed text is **not** discarded — there is no separate draft buffer, so reopening the same anchor shows the same unsaved text |
| ED6 | Submit review (batch) | P1 | ≥1 comment with text | editor-submit-review-btn | shows the total comment count; disabled while every comment is empty; submitting clears the gutter and posts a `ReviewCommentCard` to the chat |
| ED7 | Right-click on a gutter line | P1 | editor with an LSP language mapping | editor-context-menu-copy, editor-context-menu-copy-ref, editor-context-menu-add-context | Copy Reference writes `path:line (word)`; Add Agent Context sets the composer quote to the same reference; Go to Definition / Find All References are disabled for file types with no LSP mapping |
| ED8 | Review modal — scope switch | P0 | review modal open | review-scope-${…} | Uncommitted / Branch / Session scopes swap the comparison line and file set independently; Session scope under the mock CLI lists no files and reports no totals |
| ED9 | Review modal — commit | P0 | review modal open, Uncommitted scope | review-commit-input, review-commit-submit, review-commit-suggestion-${…}, review-commit-unviewed-warning | submit disabled until a message is entered; a suggestion chip prefixes the message; unviewed files are flagged before commit; committing stages and commits every changed file |
| ED10 | Review modal — viewed toggle | P1 | file selected | review-viewed-toggle, review-viewed-counter | marks the file viewed and advances the header progress counter |

## Git & worktrees

_Spec: `git-branch.spec.ts` — comprehensive. Renamed since the pre-v2 doc: the old `branch-*` ids are
now `git-*`._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| GB1 | Open popover, lazy-load | P0 | git project | main-toolbar-branch, git-branch-popover | branches lazy-load on open, not eagerly with the toolbar |
| GB2 | Search / section collapse | P1 | popover open | git-branch-search, git-branch-section-toggle-${…} | filters by substring; the Local section header collapses/expands its rows independently of Remote |
| GB3 | New branch (quick action) | P0 | popover open | git-new-branch-dialog, git-new-branch-name, git-new-branch-create | creates, checks out, and refreshes the toolbar chip in one flow |
| GB4 | Branch row flyout — checkout | P0 | row flyout open | git-submenu | switches the worktree's current branch |
| GB5 | Branch row flyout — merge / rebase | P1 | row flyout open | git-submenu | merge fast-forwards a clean ancestor branch; a conflicting merge routes to the conflict dialog instead |
| GB6 | Conflict view | P1 | merge/rebase/pull produced a conflict | git-conflict-view, git-conflict-abort | abort recovers from the conflict dialog |
| GB7 | Rename | P1 | row flyout → Rename… | git-rename-view, git-rename-input, git-rename-submit | "Rename…" hands off from the flyout to a dedicated dialog rather than inline-editing the row |
| GB8 | Delete (not-yet-merged) | P1 | row flyout → Delete | — | two-step confirm before a force-delete |
| GB9 | Pull / push / fetch / update-all | P1 | popover open | git-fetch, git-push-current, git-update-all | pull fast-forwards from the bare remote; push sends a local-only commit; quick actions (fetch/update-all/push-current) complete without error against the bare remote fixture |
| GB10 | Worktree branch — delete | P1 | branch has an attached worktree | git-worktree-row-${…} | "Delete Worktree" removes the directory, distinct from deleting the branch |
| GB11 | Worktree branch — new session | P1 | branch has an attached worktree | git-worktree-row-${…} | "New Session on Worktree" creates a worktree-scoped chat |

## Tasks / todos

_Spec: `tasks.spec.ts` — deep coverage across board/list/edit/filter/sort/GitHub-sync. Rows below name
the preconditions a new spec would need to reproduce, since the surface's `github/` subtree has no
dedicated spec file yet._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| T1 | Quick-create task | P0 | project active | tasks-quick-dialog, tasks-quick-title, tasks-quick-create | create disabled until title is non-empty |
| T2 | Full edit modal — create/edit | P0 | board open | tasks-edit-title, tasks-edit-save | shared modal for create and edit; save persists type/priority/status/labels/assignees/milestone |
| T3 | List/board view toggle | P1 | board open | tasks-view-list, tasks-view-board | switches `TaskListView` and `TaskBoardView` |
| T4 | Status cycle | P0 | ≥1 task | tasks-list-row-cycle-${…} | cycles open → in_progress → done → open on the list row, no modal needed |
| T5 | Row expand | P1 | ≥1 task | tasks-list-row-expand-${…} | reveals the body plus Start/Edit CTAs; collapse hides them again |
| T6 | Dependency picker | P1 | edit modal open, ≥1 other task | tasks-dep-input, tasks-dep-opt-${…}, tasks-dep-remove-${…} | adds/removes a dependency; the picker's candidate list excludes the task being edited |
| T7 | Attachments | P1 | edit modal open | tasks-attach-add, tasks-attach-delete-${…} | add and delete round-trip through the modal |
| T8 | Filter + sort | P1 | ≥3 tasks | tasks-filter-search, tasks-filter-opt-${…}, tasks-filter-clear | search narrows the list; a filter chip narrows further; Clear resets both; the sort menu's priority-then-number ordering is deterministic |
| T9 | Sidebar overflow | P2 | >5 active tasks | tasks-sidebar-overflow | 6th+ active task collapses into a static "N more" row rather than growing the sidebar |
| T10 | Delete | P1 | ≥1 task | tasks-list-row-delete-${…}, tasks-edit-delete | deletable from both the list row and the edit modal |
| T11 | GitHub — link / import | P1 | GitHub credential connected | tasks-github-link-dialog, tasks-github-import-dialog, tasks-github-import-issue-${…} | link requires an explicit confirm; import lists candidate issues and supports "import all" |
| T12 | GitHub — publish | P1 | task not yet linked | tasks-github-publish-dialog, tasks-github-publish-labels | publish dialog carries its own label picker, separate from the task's own labels field |
| T13 | GitHub — sync / report | P1 | task linked | tasks-github-menu-sync, tasks-github-report-dialog, tasks-github-report-row-${…} | report dialog is read-only, per-row copy action |
| T14 | GitHub — banner | P2 | credential missing or expired | tasks-github-banner, tasks-github-banner-dismiss, tasks-github-banner-report | dismiss is per-session, not permanent |

## Automations

_No spec exists (`(none)` — the plan's brief). The surface is large (~55 component files under
`features/automations/`) and entirely untested end to end; rows below cover the top-level routing and
the shape of each section, not full depth._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| AU1 | Section routing | P0 | panel open | automations-section-run, -editor, -describe, -details, -library | one body switch with a fixed precedence: run > editor > describe > details > library — e.g. an open run always wins over a pending editor target |
| AU2 | Library list | P0 | panel opens with no nav state | automations-library, automations-library-row-${…}, automations-library-new | three sub-states share the `automations-library` testid: loading, error (with retry), and the populated list — a spec must disambiguate by the child testid |
| AU3 | Library — toggle / run / edit | P1 | ≥1 automation defined | automations-library-toggle-${…}, automations-library-run-${…}, automations-library-edit-${…} | per-row actions; toggle flips enabled state without opening the editor |
| AU4 | Describe (build-from-prompt) | P1 | library empty, "Build" clicked from the blank state | automations-describe-input, automations-describe-open-editor, automations-describe-retry | reachable only from the empty-library `BlankState`; "Open editor" hands the drafted definition to the step editor |
| AU5 | Step editor | P0 | editor target set | automations-editor-name, automations-editor-save, automations-step-${…}, automations-step-config-${…} | steps are reorderable (`automations-step-grip-${…}`); `automations-editor-issues` surfaces validation problems inline rather than blocking save silently |
| AU6 | Trigger / condition builder | P1 | editor open | automations-trigger-${…}, automations-if-add-condition-${…}, automations-if-match-all, automations-if-match-any | match-all vs. match-any is a per-branch toggle, not global to the automation |
| AU7 | Run view | P0 | a run id is active | automations-run-view, automations-run-timeline, automations-run-again, automations-run-cancel | timeline renders step-by-step; "Run again" re-invokes with the same inputs; cancel is only available while the run is in-flight |
| AU8 | Run — interactive step forms | P1 | a step needs input mid-run | automations-run-step-${…}-form | pending-interaction count surfaces in the header (`automations-title-count`, "N need you") across every section, not just Run |
| AU9 | Details | P1 | library row clicked | automations-details-tab-${…}, automations-details-runs, automations-details-step-${…} | tabbed overview/steps/runs; `automations-details-not-found` covers a deleted-automation deep link |

## Viewers & preview

_Specs: `viewers.spec.ts`, `preview.spec.ts` — thorough; rows below name the state-machine edges._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| V1 | Image viewer zoom | P1 | image file open | viewer-image-zoom-in, viewer-image-zoom-out | opens in Fit mode with zoom controls disabled; switching to 100% enables them |
| V2 | SVG preview/code toggle | P1 | svg file open | viewer-svg-source | opens in Preview mode by default; Code toggle shows the raw source |
| V3 | CSV table | P1 | csv file open | viewer-csv-filter, viewer-csv-header-${…} | filter narrows rows and shows an empty-filter row when unmatched; clicking a column header cycles sort asc → desc → off |
| V4 | Unsupported file | P2 | file type with no viewer | viewer-unsupported, viewer-unsupported-open, viewer-unsupported-reveal | offers open-externally and reveal-in-tree instead of a preview |
| V5 | Reveal in tree | P1 | any viewer open | viewer-shell-reveal | highlights the open file in the Files panel (see WS5) |
| P1 | Launch state machine | P0 | launch config exists | preview-body-starting, preview-body-running, preview-body-stopped, preview-body-failed | toolbar controls stay locked through Starting; unlock only once Running; a nonexistent executable reaches Failed, not a silent hang |
| P2 | Device toggle | P2 | preview running | preview-device-desktop, preview-device-mobile | switches the frame between the desktop and a 390×844 mobile frame |
| P3 | Inspect | P0 | preview running | preview-toolbar-inspect, preview-inspect-active-indicator | toggles its own active indicator as local UI state — there is no native element pick without a live webview |
| P4 | Screenshot / region capture | P0 | preview running | preview-toolbar-capture, preview-toolbar-region | both open the annotation popover on completion; both need the native `webview.capture`/region-select bridge to produce a real result |
| P5 | Stop / restart | P0 | preview running | preview-run-stop, preview-run-restart | Stop returns the body to the stopped CTA and re-locks the toolbar; clicking the stopped-body CTA restarts back to running |
| P6 | URL bar | P1 | preview running | preview-url-input | normalizes valid input; flags invalid input inline |

## Daemon picker & connection

_Spec: `daemon-picker.spec.ts` — comprehensive across add/pair/remove/unreachable flows._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| D1 | Open picker | P0 | app running | daemon-footer-trigger, daemon-picker | footer trigger opens the picker; local daemon row always shows the active check and a connected status dot |
| D2 | Add remote — URL to pairing | P0 | picker open | daemon-add-url, daemon-add-verify, daemon-add-device | walks URL step → device step; back navigation returns without pairing; an unreachable URL shows an error state with retry |
| D3 | Complete pairing | P0 | valid remote URL verified | daemon-pair-code | adds a remote daemon row and auto-switches the active daemon, showing a "Paired" confirmation |
| D4 | Unreachable overlay | P0 | active daemon connection drops | daemon-unreachable, daemon-unreachable-switchlocal | switch-to-local recovers without losing the picker's other rows |
| D5 | Manage remote row | P1 | ≥1 remote daemon | daemon-dialog-confirm | rename updates the row label; remove needs confirm before the row disappears |

## Settings, skills & tour

_Specs: `settings.spec.ts`, `sidebar-chrome.spec.ts` for Settings; no dedicated spec for the tour. Skills
has no standalone UI of its own — the browsing surface lives in the Session panel's Context section
(see SP9); `features/skills` contributes only data hooks, no testids._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| SE1 | Open / close | P0 | app running | settings-dialog, settings-dialog-close | ⌘, opens via global hotkey; Esc and the close button both work; five tabs render — there is no keybindings tab |
| SE2 | Appearance | P1 | General tab | — | a token change applies live and persists across reload |
| SE3 | Worktree dir | P1 | General tab | settings-worktree-dir-input, settings-worktree-dir-save | Save button shown only while dirty; value persists on reopen |
| SE4 | Notification toggles | P1 | Notifications tab | settings-notify-${…}-toggle | a flipped toggle persists across reopen; a failed PATCH reverts it via resync (leaf-patch with resync-on-failure), not an optimistic-forever state |
| SE5 | Providers | P1 | Providers tab | settings-nav-provider-${…}, settings-pane-provider-${…} | lists the claude adapter; executable path commits on blur; default session mode / model / system-prompt / plan-mode all persist on reopen |
| SE6 | About | P2 | About tab | settings-pane-about | version and author come from the host bridge; no check-for-updates button in this build |
| SE7 | Remote Access — named tunnel | P0 | Remote Access tab, no config | named-tunnel-token-input, named-tunnel-url-input, named-tunnel-save | Save disabled until both fields are filled |
| SE8 | Remote Access — quick tunnel | P1 | no named config | quick-tunnel-toggle | present and enabled; starting it is out of scope for a mocked-CLI spec |
| SE9 | Remote Access — pairing | P1 | tunnel ready | pairing-generate-code, pairing-code-copy | 5-minute countdown, gated on tunnel verification |
| SE10 | Sidebar rail collapse | P1 | app running | sidebar-collapse | ⌘B toggles from anywhere; the rail button and the shortcut are two paths to the same store flag |
| SE11 | Sidebar → Tasks / Workflows | P0 | app running | sidebar-tasks, sidebar-workflows | opens the tasks board / automations panel respectively |
| SK1 | Skills in Context | P1 | session panel Context section open | session-panel-skill-${…}, session-panel-skills-manage | see Session panel SP9 — this is the only skills-browsing surface |
| TR1 | Tour steps | P1 | first launch, tutorial not completed | tour-overlay, tour-spotlight, tour-next-btn, tour-back-btn, tour-skip-btn, tour-step-dot-${…} | fully button-driven (no auto-advancing steps); four steps anchor on `[data-tut]` targets (sessions, composer, model, workspace) measured via `getBoundingClientRect`, so it survives any CSS transform on the anchor |

## Terminal, run & URL tabs

_No dedicated spec (the plan's `(none)`). These render inside workspace tabs — see Workspace surface
WS1/WS7 for how a tab of each kind is created._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| RT1 | Terminal tab | P1 | terminal tab active | run-terminal-${…} | PTY instance; only the active tab in a pane is visible, mounted lazily like every other file/process tab |
| RT2 | Console drawer | P1 | process tab with log output | run-console-drawer-toggle, run-console-clear | clear button hidden when the log is empty (`count === 0` → renders nothing); drawer resize is draggable and its height persists |
| RT3 | URL tab body states | P1 | url tab active | url-tab-body-loaded, url-tab-body-failed, url-tab-body-invalid, url-tab-body-pending, url-tab-body-rejected, url-tab-body-stopped | a corrupt persisted tab with no URL resolves to the `invalid` state, never a placeholder; retry is available from the failed state |
| RT4 | URL tab toolbar | P2 | url tab active | url-tab-toolbar | controls that need a process (reload/clear-cache) are hidden rather than disabled — a URL tab has no process behind it |
| RT5 | URL tab inspect | P2 | url tab active, preview-style inspect available | url-tab-inspect-active-indicator | same local-state toggle pattern as the preview surface's Inspect (see Viewers & preview P3) |

## Recommended authoring order

1. **The five starred surfaces already have deep specs** (session panel, session tabs, workspace +
   Files, spotlight, gates) — the highest-value remaining gap is **Automations**, which has none.
2. Within Automations, start with the P0 rows: section routing (AU1), the library's three
   sub-states (AU2), the step editor's save path (AU5), and the run timeline (AU7) — those four cover
   the whole navigation shell and the one flow (build → save → run) that exercises the daemon contract.
3. **Terminal/Run/URL tabs** are the next gap without a spec — RT2's log-empty hidden-button case and
   RT3's `invalid` fallback are the two edges most likely to regress silently.
4. For every other surface, prefer extending the existing spec file over adding a new one — the rows
   above exist to keep preconditions and disabled/hidden states visible to whoever picks up the next
   case, not to imply the surface is untested.
5. Feed each flow row to the `test-scenarios` skill for a QA-ready scenario, then translate to a
   Playwright spec using the existing `fixtures/` + `.locator('[data-testid=...]')` conventions; audit
   with `e2e-reviewer`.
