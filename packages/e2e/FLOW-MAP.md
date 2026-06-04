# E2E Flow Map — All Untested Surfaces

_Generated 2026-05-30 by reading the renderer components/handlers, anchored on the test-id gap
list in [`COVERAGE-GAP-REPORT.md`](./COVERAGE-GAP-REPORT.md). These are the **edges** (sequences,
preconditions, conditional rendering) that test-ids alone don't encode — the input for the
`test-scenarios` skill and for authoring specs._

Priority key: **P0** critical user path · **P1** important · **P2** edge/secondary.

> **Coverage note:** the first 5 sections (Todos, Chat cards, Composer, Sandbox, Branch) were the
> initial high-priority pass; sections 6–11 (Sessions, Skills/Plugins/Tutorial, Files/Editor/Review,
> Thread/Messages, Navigation & Layout, Settings/Remote/Chrome) complete the sweep across every
> remaining surface.

### Exclude — test-only fixture IDs (NOT product UI)

These appear only in component unit tests, never in the running app. They inflated the raw
"untested" count and should be **removed from the denominator**, not tested in e2e:
`btn`, `row`, `sub`, `tl`, `outside`, `slot-action`, `thrower-output`, `my-label`, `my-row`,
`plugin-view`. (`thumb-name` IS real — chat image thumbnails.)

### Dormant / unwired code (don't test until wired)

- **`LineCommentPopover`** (`editor-line-comment-input` / `-send` / `-close`, popover variant of
  `line-comment-widget`) is not imported by any consumer. The live editor-comment path is
  `editor-inline-comment-*` via the glyph margin. `14-editor.spec.ts` targets a non-existent
  `line-comment-popover` — fix to `line-comment-widget` + `editor-inline-comment-input`.
- **`settings-modal`** testid is absent from the DOM even though `TutorialOverlay` queries it;
  only `settings-modal-close` exists. Add the testid or anchor tests on the close button.
- **Tutorial `data-tutorial="step-1"/"step-2"`** are not attached to any element — those steps
  auto-advance and the overlay is invisible until step 3 (composer) / step 4 (adapter dropdown).

---

## TODOS (panel restructured — 19-todos.spec.ts is stale, rewrite)

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| T1 | Quick-create task | P0 | project active; todos plugin registered `quick-create` action (triggered via `usePluginLayoutStore.triggerAction`, **not** a panel button) | todos-quick-dialog, -title-input, -body-input, -create, todos-label-input | create disabled until title non-empty; "No active project" toast; image paste ≤10MB; Cmd+Enter submits |
| T2 | Full modal — create | P0 | TodosPanel visible | todos-new, todos-modal-dialog, -title/-type/-priority/-status-select, -body-input, -save | `todos-modal-upload`/`-file-input` exist **only in create mode**; save disabled until title set |
| T3 | Full modal — edit | P0 | ≥1 todo exists | todos-modal-* , todos-modal-cancel, -close | edit mode swaps upload UI for `TodoAttachments`; cancel==close; Esc closes |
| T4 | Attachments on existing todo | P1 | modal open in edit | todos-attachments-upload, -file-input | only images .jpg/.png/.gif/.webp ≤10MB; >10MB silently skipped |
| T5 | Dependencies add/remove | P1 | modal open; ≥1 other todo | todos-dep-add-toggle, -search | toggle hidden when no candidates; max 5 shown w/o search; Esc closes dropdown |
| T6 | Filtering | P1 | todos loaded | todos-filter-search, -search-clear, -labels-toggle, -filter-clear | labels-toggle only if a label exists; filter-clear only when filter active; search is title-only |
| T7 | Start session from in-progress todo (modal) | P0 | todo status==in_progress; modal edit | todos-modal-start-session | button absent unless status==in_progress; pulls attachments → composer; activates fullview |
| T8 | Load failure + retry | P1 | daemon down / API fails | todos-retry | manual retry only; no auto-retry; error screen replaces board |

---

## CHAT INTERACTIVE CARDS (permission / plan / question)

Routing in `BottomCard`: `AskUserQuestion`→question card, `ExitPlanMode`→plan card, else→permission card.
All replace the composer while `pendingPermission` is set; session bar shows "Awaiting".

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| C1 | Permission — allow once | P0 | CLI `can_use_tool` for non-question/non-plan tool | chat-permission-allow-once-button, -details-toggle | allow-once sends no `updatedPermissions` → re-prompts next time; 3s watchdog re-shows if response lost |
| C2 | Permission — deny | P0 | same | chat-permission-deny-button | deny w/o interrupt doesn't stop the turn |
| C3 | Permission — always allow | P1 | `request.suggestions.length>0` | chat-permission-always-allow-button | **button absent when suggestions empty** — test both states; sends suggestions verbatim |
| C4 | Plan — approve | P0 | chat in plan mode; CLI calls ExitPlanMode | chat-plan-approve-button, -exec-mode-select, -clear-context-checkbox | exec-mode `yolo`→bypassPermissions; clearContext=true wipes history + restarts CLI |
| C5 | Plan — reject | P0 | same | chat-plan-reject-button | bare deny, no message |
| C6 | Plan — revise loop | P1 | same | chat-plan-revise-button, -feedback-input, -send-feedback-button, -cancel-revise-button | send disabled until feedback non-empty; Cmd+Enter sends; loop repeats until approve/reject |
| C7 | Question — single-select submit | P0 | AskUserQuestion, 1 question, multiSelect:false | chat-question-option-<label>, -submit-button | submit disabled until a pick; selecting replaces prior |
| C8 | Question — multi-select | P1 | multiSelect:true | chat-question-option-<label>, -submit-button | toggles add/remove; submit enabled while ≥1 selected |
| C9 | Question — "other" free text | P1 | any question | chat-question-option-other, -other-input | empty "other" → filtered to '' / []; deselect hides input |
| C10 | Question — skip | P1 | any | chat-question-skip-button | bare deny anytime, discards selections |
| C11 | Question — multi-question nav | P1 | questions.length>1 | chat-question-next-button, -back-button, -submit-button | back absent on Q1; Next↔Submit swap on last; selections persist across nav |

_(The review-changes button and PR badges are session-bar actions, not cards — see SP13/SP14.)_

---

## COMPOSER

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| M1 | Type + send | P0 | chat open, not running, worktree present | composer-prompt-input, -prompt-highlight, -send | send disabled when empty & no captures; Shift+Enter=newline; worktreeMissing disables input |
| M2 | Stop / interrupt | P0 | agent running | composer-stop | stop replaces send while running; race no-op if finishes first |
| M3 | Queue while running + edit/cancel | P1 | agent running | composer-queued-edit, -edit-input, -save, -cancel | Enter while running queues; save no-ops if unchanged/empty; cancel = immediate, no confirm |
| M4 | Adapter select | P1 | no messages yet | composer-adapter-select | **disabled once hasMessages**; resets model to adapter default |
| M5 | Model select | P1 | any | composer-model-select | hides effort if model's supportedEfforts is empty/absent |
| M6 | Effort select + features popover | P2 | model with supportedEfforts + not running | composer-effort-select, composer-features-trigger, composer-feature-{key} | effort hidden for models with no supportedEfforts; option set is per-model; ultracode locks chip to xhigh; disabled while running |
| M7 | Permission-mode select | P1 | any | composer-permission-mode-select | yolo renders red; controls auto-approval level |
| M8 | Attach file | P1 | no error showing | composer-attach, composer-attachments | >5MB → error banner |
| M9 | Dismiss composer error | P2 | composerError set | composer-dismiss-error | clears banner |
| M10 | Open context picker | P1 | project open | composer-context-picker | also `@`/`/` triggers; arrow/enter/esc nav |
| M11 | Worktree enable — new branch | P1 | git project, no active worktree | composer-worktree, -enable, -branch-name, -tab-new, -cancel | name regex validation inline; mid-session warns "paused & resumed" |
| M12 | Worktree enable — existing | P1 | git project, existing worktrees | composer-worktree-tab-existing | "No worktrees found" empty state |

---

## SANDBOX (28-sandbox-launch.spec.ts partial)

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| S1 | Start process | P0 | launch config exists, status stopped | sandbox-button-start, -restart, -stop | start→starting→running; preview shows spinner; retries url ≤15× |
| S2 | Stop single | P0 | running | sandbox-button-stop | resets webviewReady |
| S3 | Stop all (popover) | P1 | ≥1 running | sandbox-button-stop-all, -stop-process-{name} | Promise.all; click-outside closes |
| S4 | Restart | P1 | running | sandbox-button-restart | stop→clear logs→start; logs clear between |
| S5 | Reload webview | P1 | preview running, webviewReady | sandbox-button-reload | no-op if ref null |
| S6 | Inspect / element pick | P0 | preview ready | sandbox-button-inspect | 2nd click cancels; Esc cancels; zoom-corrected crop; auto-creates chat |
| S7 | Full screenshot | P0 | preview ready | sandbox-button-screenshot, capture-thumb | adds capture; auto-creates chat |
| S8 | Region capture + annotate + submit | P0 | preview ready | sandbox-button-region-capture, -submit-captures, -cancel-capture, capture-meta-row | submit disabled until ≥1 region; <4px drag ignored; per-region remove |
| S9 | Cancel region capture | P1 | capturing | sandbox-button-cancel-capture | button/Esc/re-click all exit, discard pending |
| S10 | Mobile view toggle | P2 | preview ready | sandbox-button-mobile-view | 390×844; resets on tab switch |
| S11 | Console toggle + clear logs | P1 | process selected | sandbox-button-toggle-console, -clear-logs | clear disabled if no process; per-tab state; 500-entry cap |
| S12 | Clear session | P2 | Electron, project active, running | sandbox-button-clear-session | non-Electron: not rendered; reloads after clear |
| S13 | Generate with agent | P1 | LaunchPopover open, project active | sandbox-button-generate-with-agent | sends `/launch-config`; creates chat if none |
| S14 | Capture thumbs in composer + remove | P1 | ≥1 capture | capture-thumb, -thumb-name, -thumb-remove, captures-container, capture-meta-row, sandbox-capture-context | meta-row only when selector/annotation; send enabled with captures + empty text |

---

## BRANCH / WORKTREE (no existing spec)

All flows: git project active, daemon connected. API endpoints under `/api/projects/:id/git/*`.

| # | Flow | Pri | Key test-ids | Notable edges |
|---|------|-----|--------------|---------------|
| B1 | Open/close popover | P0 | branch-button, branch-popover-search-input | absent if no git repo; worktree banner if active |
| B2 | Search/filter branches | P1 | branch-popover-search-input, branch-list-local/remote-toggle | filters local+remote+groups; "No matching branches" |
| B3 | Expand/collapse sections | P1 | branch-list-local-toggle, -remote-toggle | remote-toggle only if remotes exist |
| B4 | Submenu (local branch) | P0 | branch-submenu-dialog, branch-row-select-* | current/worktree branches disable subset of actions |
| B5 | Submenu (remote branch) | P1 | branch-list-remote-row-*, branch-submenu-dialog | delete-remote confirms |
| B6 | Checkout | P0 | branch-submenu-item-checkout | dirty-tree confirm; updates status bar |
| B7 | Fetch | P1 | branch-popover-fetch | busy disables all; pulse icon |
| B8 | Push | P1 | branch-popover-push | reject toast; no-tracking → daemon default |
| B9 | Update all | P1 | branch-popover-update-all | conflict → ConflictView |
| B10 | New branch (quick action) | P0 | branch-popover-new-branch, new-branch-dialog, -name-input, -start-point-select, -create, -cancel, -back | name regex + exists check client-side; back/cancel no API |
| B11 | New branch from specific | P1 | branch-submenu-item-new-branch-from-…, new-branch-start-point-select | start-point pre-selected |
| B12 | Rename | P1 | branch-submenu-item-rename, rename-branch-name-input, -rename, -cancel, -back | rename disabled if empty; Enter submits |
| B13 | Delete local | P1 | branch-submenu-item-delete-branch | confirm; not-merged → force confirm |
| B14 | Pull | P1 | branch-submenu-item-pull | no-tracking error; conflict → ConflictView |
| B15 | Merge into current | P1 | branch-submenu-item-merge-into-current-branch | conflict → conflict-view-dialog + abort |
| B16 | Rebase onto | P1 | branch-submenu-item-rebase-current-onto-this | conflict path; abort |
| B17 | Conflict / abort view | P1 | conflict-view-dialog, conflict-view-abort | popover opens directly in conflict view |
| B18 | Worktree sections | P2 | worktree-section-toggle/-new-session/-delete-* | delete confirms; new-session creates chat |

_(Worktree/branch info shown in the session list & import popover are session-surface flows — see SP15/SP16.)_

---

## SESSIONS PANEL (left list + session bar) — partial: 02-projects, 04-chat-lifecycle, 21-multi-chat, 35-external-sessions

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| SP1 | New session — single project | P0 | exactly 1 project | chats-new-session | disabled when 0 projects; immediate create |
| SP2 | New session — multi-project picker | P0 | ≥2 projects, no filter | chats-new-session, chats-new-session-project-{id} | with active filter, skips popover & creates in filtered project |
| SP3 | Select / switch session | P0 | ≥1 chat | chat-list-item, session-title-text, session-bar | clicking row buttons doesn't select (stopPropagation); waiting/worktreeMissing/unread badges |
| SP4 | Filter by project pill | P1 | ≥2 projects | chats-filter-pill-{name}, chats-filter-pill-All | toggle on/off; auto-activates most recent; persisted to localStorage |
| SP5 | Filter by tag / clear | P1 | a tag/worktree/PR exists | session-filter-tags, chats-clear-filters | AND-filter; synthetic has-pr/has-worktree pills; bar absent when nothing to filter |
| SP6 | Rename session | P1 | ≥1 chat | chats-session-rename-{id}, chats-session-rename-input-{id}, session-title-text | Enter commits, Esc cancels; empty=no-op; re-focus on re-sort |
| SP7 | Row context menu | P1 | ≥1 chat | chat-list-item (right-click), session-row-actions | Tags/Rename/Pin/Archive/Copy-Session-ID; group header → Delete Project |
| SP8 | Archive session | P1 | ≥1 active chat | chats-session-archive-{id} | worktree → confirm delete-or-keep; activates next chat |
| SP9 | View + restore archived | P1 | ≥1 archived | archived-sessions-btn, archived-session-item, restore-session-btn | "No archived sessions"; scoped to project filter |
| SP10 | Session bar identity | P0 | chat active | session-bar, session-bar-branch, session-bar-model | status: Thinking/Awaiting/Compacting/Starting/Error/Worktree-Missing; context % bar |
| SP11 | Background tasks pill + popover | P1 | ≥1 running bg task | chat-session-bar-bg-tasks-pill, -popover | pill absent if none; kill button; recovered marker; no outside-click close |
| SP12 | Add project | P1 | panel open | chats-add-project | opens DirectoryPickerModal |
| SP13 | Review changes button | P2 | chat active | chat-review-changes-button | session-bar action; Cmd+Shift+R; opens the Review modal (F12); absent if chat not found |
| SP14 | PR badges | P2 | daemon emits `chat.prDetected` | chat-pr-badges | session-bar; absent when none; opens external; created>mentioned precedence |
| SP15 | Session row worktree pill | P2 | chat has worktreePath | worktree-pill | blue badge in the session row; tooltip shows full path |
| SP16 | Import external session (branch/worktree) | P2 | ImportSessionsPopover open; external sessions w/ metadata | external-session-branch, external-session-worktree, import-session-btn | branch/worktree labels shown only when metadata present |

## SKILLS PANEL / PLUGINS / TUTORIAL

_Tool-call cards render **inline in the chat thread** — they live in the THREAD section (TH8–TH13),
not here. This section is the standalone surfaces._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| SK1 | Skills panel browse + invoke | P1 | project active, skills loaded | skills-item-name-{id}, -menu-{id}, -edit-{id}, -delete-{id} | left panel (not thread); click row → sets composer pending invocation; plugin skills have no Delete |
| SK2 | Plugin fullview | P1 | fullview contribution registered | fullview-modal, -backdrop, -button-close | the plugin rendered inside the fullview modal; modal open/close mechanics = NL2 |
| SK3 | Tutorial next/skip | P1 | first launch, no messages | tutorial-next-btn, tutorial-skip-btn | steps 1-2 auto-advance (no Next); overlay invisible until step 3 |

## FILES / EDITOR / REVIEW — partial/stale: 12-changes-tab, 14-editor (dead selectors, see report)

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| F1 | Files panel browse + refresh | P0 | project active, files tab | zone-tab-files, files-root-toggle, files-refresh, files-tree-node-{path} | refresh hidden <160px width; auto-refresh on context.updated/focus |
| F2 | Expand dir / open file | P0 | root expanded | files-tree-node-{path} | dir toggles+loads children; file → openEditorTab |
| F3 | File viewer navigation | P0 | diff open, >1 hunk | fileview-next-change, -prev-change, -reveal-in-tree, -collapse | next/prev only when diffChangeCount>1; reveal only when filePath set |
| F4 | Expand collapsed file view | P1 | fileView set & collapsed | layout-expand-file-view | rail absent when no file open |
| F5 | Changes tab refresh + mode | P0 | changes tab | zone-tab-changes, changes-refresh, changes-{session/uncommitted/branch}-file-{path}, zone-button-tab-dropdown | refresh disabled if session mode & no chat |
| F6 | Find in path modal | P1 | right-click dir → Find in Path | find-in-path-modal, -input, -include-ignored, -close | include-ignored only for dir scope; 200-result cap; debounced; Esc/backdrop close |
| F7 | Inline comment add + send | P0 | editor with onLineComment | line-comment-widget, editor-inline-comment-input, -send, -cancel | send disabled when empty; Enter sends, Shift+Enter newline; via glyph margin |
| F8 | Submit review (batch) | P1 | ≥1 comment widget w/ text | editor-submit-review | "Submit review (N)"; disabled if all empty; closes all on submit |
| F9 | Center: save file | P0 | dirty editor file | center-button-save | Cmd+S; no-op for external/null path |
| F10 | Center: disk-change banner | P0 | dirty + file:changed event | center-button-reload-from-disk, center-button-keep-mine | reload loses edits; keep-mine preserves; silent reload if not dirty |
| F11 | Directory picker | P0 | picker open | dir-picker-modal, dir-entry-{path}, directory-picker-cancel, -close, dir-picker-select-btn | cancel==close; Esc/backdrop cancel; select disabled until valid selection |
| F12 | Review changes modal | P0 | chat w/ projectId | review-modal, review-button-close, review-button-mode-inline, -side-by-side | opened via chat-review-changes-button / Cmd+Shift+R (= SP13); FileTree + DiffView of git changes; **no backdrop/Esc close**; mode toggle only when a file is selected |

## THREAD / MESSAGES

_Interactions rendered **inside a chat message thread**. App-shell/navigation surfaces (search
palette, modals, zones) live in the next section, not here._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| TH1 | Find in thread (open/search/nav/close) | P0 | chat w/ messages | find-bar, thread-find-input, -next, -prev, -close | Cmd+F; 80ms debounce; wraps; next/prev disabled at 0 matches; Esc closes; needs CSS Highlight API; only user+assistant text indexed |
| TH2 | Quote selection into composer | P1 | text selected in thread | thread-quote | excludes composer selection; blockquote-prefixed; clears selection |
| TH3 | Expand/collapse truncated tool result | P1 | server-truncated result | thread-tool-result-expand, -collapse | async fetch full; error → "no longer available" |
| TH4 | Copy code block | P1 | assistant code block | message-part-copy | icon→check 2s; silent fail in insecure ctx |
| TH5 | Copy URL from link | P2 | markdown link | message-part-copy-url | tooltip on hover; also right-click menu |
| TH6 | Toggle thinking block | P1 | reasoning part | message-part-thinking-toggle | per-instance; CSS animated |
| TH7 | Read more / show less | P1 | user msg >600 chars | message-read-more | absent ≤600 chars; counts node text not pixels |
| TH8 | Generic tool card expand | P0 | non-special tool call, result defined | tool-card, tool-card-toggle | hideToggle hides icon but toggle still works; truncated → ToolResultExpand |
| TH9 | MCP tool card expand | P0 | mcp__* tool done | tool-mcp-expand | disabled while running/error; tooltip full name; server prefix stripped |
| TH10 | Skill loaded card expand | P0 | skill_loaded child in TaskGroup | tool-skill-expand | only inside TaskGroupCard; top-level Skill = non-expandable SlashCommandCard |
| TH11 | Schedule tool card expand | P1 | CronList(>0)/Monitor(content) | tool-schedule-expand | ScheduleWakeup/CronCreate/CronDelete not expandable |
| TH12 | Task subagent group expand | P0 | _TaskGroup tool | tool-task-group-toggle | recursively renders child cards; dedups prompt; strips usage |
| TH13 | Task/agent tracking card | P0 | Task/Agent tool | task-card, task-card-agent, task-card-model | non-expandable; usage stats on complete; model optional |
| TH14 | Selector breadcrumb (display) | P2 | selector path in a message/composer bubble | selector-breadcrumb, selector-crumb | renders in message/composer bubbles (not the sessions panel); clip-path chevrons; collapses >3 segments; render-only |

## NAVIGATION & LAYOUT (app shell)

_App-wide navigation and panel/window chrome — not tied to any one chat thread._

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| NL1 | Global search palette | P0 | project + sessions | search-palette-dialog, -input, search-palette-session-{id}, -file-{path} | Cmd+O; command palette over sessions+files; ≥2 chars triggers file search; arrow nav; resizable |
| NL2 | Fullview modal (open/close/backdrop/esc) | P1 | fullview plugin | fullview-modal, -backdrop, -button-close | toggle semantics; inner click stopPropagation; hosts the plugin in SK2 |
| NL3 | Zone minimize | P1 | zone expanded | zone-button-minimize | sets activeTab null; tab re-opens |
| NL4 | Zone tab dropdown | P2 | dropdown-style tabs | zone-button-tab-dropdown, zone-tab-dropdown-option-{id} | outside-click closes; buttons-style uses zone-tab-{id} |
| NL5 | Context section toggle | P2 | context section count>0 | context-section-title | right-rail context tab; native details/summary; absent when count 0; click summary not the label |

## SETTINGS / REMOTE ACCESS / TERMINAL / CHROME

| # | Flow | Pri | Preconditions | Key test-ids | Notable edges |
|---|------|-----|---------------|--------------|---------------|
| SE1 | Open settings | P0 | app running | left-rail-settings, settings-modal-sidebar-tab-{id} | Cmd+,; re-fetches on open; **no `settings-modal` root testid** |
| SE2 | Close settings | P0 | settings open | settings-modal-close | X / backdrop / Esc |
| SE3 | Set + save worktree dir | P1 | General tab | general-worktree-dir-input, -save | save shown only when dirty; Enter saves; no validation; no error UI |
| SE4 | Configure named tunnel (first time) | P0 | Remote Access tab, no config | named-tunnel-token-input, -url-input, -save | save disabled until both fields; state starting→verifying→ready; save error has no testid |
| SE5 | Stop/start named tunnel | P1 | config saved | named-tunnel-toggle | disabled mid-action |
| SE6 | Clear named tunnel config | P1 | config saved | named-tunnel-clear-config | restores form; re-shows quick tunnel; hides pairing |
| SE7 | Enable quick tunnel | P1 | no named config | quick-tunnel-toggle | only shown when no named config; dns_verified=false → unreachable |
| SE8 | Re-check DNS | P2 | tunnel unreachable | tunnel-recheck-verify | no guard on repeat clicks |
| SE9 | Generate pairing code | P1 | tunnel ready | pairing-generate-code, pairing-code-copy | 5-min countdown; gated on tunnel.verified; silent error |
| SE10 | Regenerate pairing code | P2 | code displayed | pairing-regenerate-code | disabled while generating |
| SE11 | Open new terminal | P0 | project active, terminal panel | terminal-button-new, terminal-panel | empty state msg; tab per terminal; close kills |
| SE12 | Project group name/parent | P2 | project w/ parent | project-group-name, project-group-parent | parent row only if parentProjectId; collapse persisted |
| SE13 | App update download | P1 | update available | status-bar-update-download | "Downloading N%"; download error not surfaced |
| SE14 | App update install | P1 | update downloaded | status-bar-update-install | restarts app |
| SE15 | Connection overlay | P0 | daemon disconnects | connection-overlay | z-9998 covers all incl. settings; no controls; auto-unmounts on reconnect |
| SE16 | Error boundary retry | P1 | render error in boundary | error-boundary-retry | custom fallback omits the button; recurs if unresolved |
| SE17 | Status bar branch button | P1 | git project | status-bar-branch | bottom status-bar (chrome); opens BranchPopover (= the B1 trigger); worktree icon; conflict warning; 60s poll |
| SE18 | Default-model dropdown | P2 | settings ModelDropdown open | model-dropdown-trigger | sets the default model for NEW sessions, not the active chat |

## Recommended authoring order

1. **Repair** stale specs first so the suite is honest: the 19 dead testid selectors plus the
   role/text-based ones flagged in the gap report (`right-panel`, zone tabs as `role="tab"`,
   `line-comment-popover`). Drop fixture IDs from the denominator.
2. **P0 flows**, surface by surface:
   - Todos (T1,T2,T3,T7) → Chat cards (C1,C2,C4,C5,C7) → Composer (M1,M2) → Sandbox (S1,S6,S7,S8) → Branch (B1,B4,B6,B10)
   - Sessions (SP1,SP2,SP3,SP10) → Tool cards in thread (TH8,TH9,TH12,TH13) → Files/Editor/Review (F1,F2,F3,F5,F7,F9,F10,F11,F12)
   - Thread (TH1) → Navigation (NL1) → Settings/Chrome (SE1,SE2,SE11,SE15)
3. **P1**, then **P2**.
4. Feed each flow row to the `test-scenarios` skill for a QA-ready scenario, then translate to a
   Playwright spec using the existing `fixtures/` + `.locator('[data-testid=...]')` conventions;
   audit with `e2e-reviewer`.
