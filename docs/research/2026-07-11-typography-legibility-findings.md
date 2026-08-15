# Typography & legibility audit — consolidated findings (2026-07-11)

Worklist companion to
[2026-07-11-typography-legibility-audit.md](2026-07-11-typography-legibility-audit.md)
(read that first for the root causes R1–R7, the measured contrast table, and
the remediation recipes referenced below). Paths relative to
`packages/ui/src`. Line numbers verified on audit day against `main`.

Grading: **P0** invisible/unreadable must-read content · **P1** fails
legibility norms (size and/or contrast) · **P2** inconsistency/polish.

## P0 — invisible content (exhaustive)

All are `mf-text-4`-grade contrast (≈1.5–2.3:1) carrying meaning. Fix: move to
`mf-text-3` (re-tinted) or `muted-foreground`, and promote `micro`→`caption`
where noted.

| Site | What's invisible |
|---|---|
| `features/sessions/sidebar/DraftSessionRow.tsx:80` | "draft — clears if you leave without sending" (micro + text-4) |
| `features/sessions/new-thread/FirstRunState.tsx:41` | "Your files stay on disk…" reassurance (micro + text-4) |
| `layout/SurfacePicker.tsx:129` | footer guidance ("opens route here automatically") (micro + text-4) |
| `features/chat/tools/cards/SearchCard.tsx:107` | "in {path}" — where the search ran (micro + text-4) |
| `components/ui/menu.tsx:64` | MenuRow keyboard hints (⌘1, ↵) (caption + text-4) |
| `features/chat/composer/ComposerEditMode.tsx:63` | "esc to cancel" (micro + text-4) |
| `features/chat/messages/QueuedUserTurn.tsx:80-81` | queued-status line, `dimmed` branch (micro + text-4) |
| `features/context-panel/BottomPanel.tsx:53-54` | inactive tab counts (micro + text-4) |
| `features/editor/DiffHeader.tsx:52` | diffed file path breadcrumb (micro + text-4) |
| `features/run/ConsolePane.tsx:121` | log-count chip (micro + text-4) |
| `features/run/ConsolePane.tsx:183` | collapsed-drawer last-log-line preview (micro + text-4) |
| `features/preview/PreviewBodyState.tsx:45,46,78` | tunnel error detail, recovery instruction, target URL (micro + text-4) |
| `features/preview/PreviewUrlBar.tsx:81` | URL bar in stopped state (text-4 branch) |
| `features/review/ReviewFileToolbar.tsx:31` | file-path directory segment (caption + text-4) |
| `features/tasks/TaskListRow.tsx:86` | "open" status ring — `border-mf-text-4` is the only open-state signal |
| `features/workflows/WfStatus.tsx:119` + `workflows/glyphs.ts:153` | "skipped" status tag color |
| `features/workflows/editor/WfYamlPane.tsx:30,44` | "canonical" tag, "Validating…" state |
| `features/git/BranchRow.tsx:22` | "up to date" divergence status |
| Borderline (meaning-bearing icons at text-4): `features/workflows/WfRunsList.tsx:25-28,127-130` | trigger icons, "child" tag |

## P1 by pattern

### A. `text-mf-text-3` on must-read text → `muted-foreground` (+ size rung where flagged ↑)

Sidebar/sessions: `SessionRow.tsx:93`↑ (timestamp, micro), `SessionRow.tsx:48`
(idle status glyph — also drop `opacity-50`), `SessionRowMeta.tsx:72`↑ (meta
row, micro), `SessionRowMeta.tsx:48`↑ (degraded AlertTriangle 9px),
`SessionGroupHeader.tsx:17`↑ (group headers — SectionHeader),
`DraftSessionRow.tsx:66`↑, `ProjectFilterPillBar.tsx:115` (Add project),
`filter/TagFilterBar.tsx:131`↑ (Tags eyebrow), `ExternalSessionRow.tsx:51,92`,
`ArchivedSessionsDialog.tsx:45,67`, `ImportSessionsDialog.tsx:41`↑ (eyebrow),
`NewSessionPickerPopover.tsx:89`↑, `SessionSidebar.tsx:53` (empty state →
body), `SessionSidebar.tsx:71`↑, `layout/SidebarFooter.tsx:11,18`↑ (status
counts).

Chrome/tabs: `layout/FilesTabStrip.tsx:92` + `layout/RunTabStrip.tsx:72`
(inactive tab titles), `layout/SurfaceRail.tsx:49` (inactive nav icons at
text-4 → text-3-new), `features/tour/WsTourLabel.tsx:44` (Step X of Y),
`features/sessions/new-thread/WelcomeState.tsx:50`,
`SuggestionRow.tsx:46,50`↑ (micro).

Chat: `tools/cards/marker-pill.tsx:64` (pill label — also ↑label),
`marker-pill.tsx:73` (icon wrapper at text-4), `marker-pill.tsx:113`↑
(ARGUMENTS/RESULT caps), `marker-pill.tsx:124`, consumers
`MCPToolCard.tsx:68`, `SchedulePillCard.tsx:92,129,136,141,198` (several at
text-4), `WorktreeStatusPillCard.tsx:78`, `SkillLoadedCard.tsx:28`;
`SearchCard.tsx:95`↑, `ReadFileCard.tsx:79`↑ (text-4),
`TaskCard.tsx:58` (model label, text-4), `TaskProgressCard.tsx:111` (pending
subject, body-size but text-3), `SlashCommandCard.tsx:31`,
`tool-group.tsx:128`↑ (redundant "N calls", text-4 — or drop),
`reasoning.tsx:134-135`, `messages/MessageTimestamp.tsx:17`↑ (text-4),
`MessageTiming.tsx:56`↑ (text-4), `SystemMessage.tsx:26,44-48`,
`QueuedUserTurn.tsx:54-55` (Edit/Cancel + head status),
`ReviewCommentCard.tsx:32,67`↑ (text-4), `code-snippet.tsx:16`↑ (line numbers,
text-4), `UserAttachments.tsx:53,102`↑, diff gutters
`tools/shared/diff.tsx:117,122,124` (text-4 → text-3-new).

Composer/panels: `composer/BackgroundActivityBar.tsx:88,92`↑,
`WorktreePopover.tsx:45,47`, `WorktreeNewForm.tsx:132,143`↑ (form labels,
micro), `WorktreeNewForm.tsx:176` (Cancel), `WorktreeExistingTab.tsx:30,43`
(inactive tab), `WorktreeExistingTab.tsx:89`↑, `EffortPicker.tsx:67` (Lock at
text-4 → warning/muted), `attachment.tsx:185-187,215-217` (toolbar button
ink), `ChatSessionInline.tsx:87`↑ (context %),
`ChatCardHeader.tsx:106,116,130` (header icons),
`context-panel/ScopedListRow.tsx:27,30`↑ (description + scope chip, micro),
`ContextSection.tsx:33,39`↑ (section header smaller than children +count),
`ContextFileItem.tsx:46`, `ContextInspector.tsx:11,47`↑,
`TasksSection.tsx:27`↑, `AgentsList.tsx:7-8`, `SkillsList.tsx:7-8`,
`components/ui/menu-variants.ts:20` (menu icon default ink).

Files/run/review/tasks/wf/settings/git: `files/ChangesPanel.tsx:177,216`↑,
`files/FileTree.tsx:263`↑ (root header stack), `files/InspectorPane.tsx:78`↑,
`editor/DiffHeader.tsx:62`, `editor/EditorTab.tsx:248` (read-only banner),
`review/ReviewCommitRail.tsx:51,113` (disabled commit),
`review/ReviewFileTree.tsx:55`↑,`:91`↑, `review/ReviewPanelHeader.tsx:57,63`,
`tasks/TaskColumn.tsx:71`, `tasks/TasksBoard.tsx:85`, `tasks/TasksDrawer.tsx:126`,
`tasks/TaskListView.tsx:205`, `wf/WfLibrary.tsx:122`↑,
`wf/WfRunsList.tsx:125,135,145`↑, `wf/WfRunDetail.tsx:135,159,225↑,232`,
`wf/WfStepNode.tsx:55,91,164,175,186,194` (skipped-step title loses contrast
when it matters most), `wf/editor/WfStepLibrary.tsx:187,229`,
`settings/general/GeneralPane.tsx:39,44` (h3s),
`settings/shared/SettingGroup.tsx:11`↑ (eyebrow),
`settings/about/AboutPane.tsx:52`, `git/BranchGroupSection.tsx:76`↑ (eyebrow),
`git/WorktreeSection.tsx:42`↑ (eyebrow), `git/BranchRow.tsx:25,83`
(counts wrapper; chevron at text-4), `git/BranchSubmenu.tsx:204`.

### B. Must-read text at `micro`/`caption` with passing color → promote rung

Chat content: `ReadFileCard.tsx:50` (code preview→label),
`diff.tsx:162,214` (diff body→label), `BashCard.tsx:66` (terminal
output→label; default line color off `mf-term-cmt`, see D),
`SearchCard.tsx:87` (pattern→label), `WebFetchCard.tsx:56,96` (URL/query),
`PlanCard.tsx:79` (plan body), `AskUserQuestionCard.tsx:83,106` (question →
body), `AskUserQuestionCard.tsx:63-67` (answer pills — also drop
`opacity-60`), `tool-fallback.tsx:111` + `tool-fallback-parts.tsx:24,47-48,80`
(unknown-tool name/args/result), `reasoning.tsx:177` (content→label),
`quote.tsx:41` (→label, drop italic), `directive-text.tsx:56` (chips→label),
`markdown-text.tsx:60-67` (inline code — use `text-[0.9em]` so it tracks
prose), `code-snippet.tsx:15` (→label), `UserMessage.tsx:143` (SlashPill),
`UserMessage.tsx:280,289` (send-failure + Retry→label),
`UserAttachments.tsx:47`↑ (ext badge, see D), `:98`,
`gates/AskQuestionWizard.tsx:73` (option descriptions→label),
`gates/AskUserQuestionGate.tsx:163` ("N of M"), `gates/GateShell.tsx:62`
(eyebrow — SectionHeader recipe; warning-hue variant see D),
`gates/PlanGate.tsx:27-30` (h3 11px < body 13px hierarchy inversion; code→label),
`gates/PlanGate.tsx:223-228` (running status — also color A).

Composer/pickers: `ProviderModelSelect.tsx:162,169` (model name→label),
`PermissionSelect.tsx:54,63` (mode→label), `ComposerEditMode.tsx:61,108`,
`WorktreeNewForm.tsx:164,167` (errors→label), `ChatCardHeader.tsx:39,69`
(session title→label/body — header is size-flat, see P2),
`ws-toast.tsx:163,176` (CTA→label; `text-primary` ≈3:1 on light, see D),
`components/ui/read-more.tsx:73` (Read more→label + color),
`components/ui/tooltip.tsx:33` (all tooltips→label).

Files/run/preview: `files/ChangesPanel.tsx:39,182,213,220`,
`files/InspectorPane.tsx:23`, `files/use-file-search.tsx:46`,
`run/ConsolePane.tsx:99` (console output→body), `:181,206`,
`preview/CaptureAnnotationPopover.tsx:40,43` (annotation input→body),
`preview/PreviewBodyState.tsx:57,89`, `preview/PreviewCaptureCluster.tsx:29`,
`review/ReviewCommitRail.tsx:81,94,101`, `review/ReviewFileToolbar.tsx:32-34`,
`review/ReviewPanelHeader.tsx:48`.

Tasks (systemic — data/inputs/CTAs at caption): `TaskCard.tsx:66,79,98,110`,
`TaskListRow.tsx:101,158,174,242,244,263,272,288,300`,
`TasksDrawerList.tsx:59,60` (title 11px vs 13px siblings),
`TaskColumn.tsx:68`, `TaskListView.tsx:163,168` (drop `/70`),
`TasksDrawer.tsx:119`, `FilterMenu.tsx:61`, `LabelAutocomplete.tsx:106`
(ghost `opacity-40`), `DependencyPicker.tsx`, `QuickTaskDialog.tsx`,
`TaskEditModal.tsx:182,218,263,273,281`, `TaskMetaFields.tsx`,
`TaskSelectFields.tsx:37,52,67`, `TasksFilterBar.tsx:108,143`,
`TaskAttachments.tsx:205,232` — all field inputs/CTAs → `label`/`body`.

Workflows: `WfStatus.tsx:119` (all status tags — size + hue policy),
`WfLibrary.tsx:100`, `WorkflowsView.tsx:52,80`,
`WfInteractionCard.tsx:104,117,168` (drop `/70`),
`WfNeedsYou.tsx:41`, `WfTree.tsx:68,128,168`, `WfbStepRow.tsx:85`,
`WfBuilderPane.tsx:35,78,236,267`, `WfbDropdowns.tsx:46`,
`editor/WfEditorChrome.tsx:80,105`, `editor/WfStepLibrary.tsx:169`.

Settings/git/dialogs: `providers/ProvidersPane.tsx:28`,
`providers/ConfigConflictsWarning.tsx:18`,
`remote-access/DevicesSection.tsx:57,73,74`,
`remote-access/NamedTunnelSection.tsx:60,105-107,115,178,186`,
`remote-access/PairingSection.tsx:64,118`,
`remote-access/QuickTunnelSection.tsx:21,50`,
`remote-access/TunnelStatusRow.tsx:23,34,44,45,55,56,60`,
`remote-access/RemoteAccessPane.tsx:16`, `git/BranchGroupSection.tsx:39`,
`git/ConflictView.tsx:37,64`, `git/NewBranchDialog.tsx:89,94,104` (branch
input→body), `git/RenameBranchView.tsx:36`,
`sessions/sidebar/ProjectPillContextMenu.tsx:49,60` (menu items),
`chat/thread/ChatSessionInline.tsx:58`, `chat/DegradedChatCard.tsx:15,24`,
`composer/ComposerTriggers.tsx:52`, `context-panel/BottomPanel.tsx:45`,
`context-panel/ScopedListRow.tsx:25`, `ContextFileItem.tsx:44`.

### C. Badges/counts (CountBadge recipe)

`sessions/sidebar/FilterPill.tsx:25-26,34-35` and
`ProjectPillContextMenu.tsx:32-33,72-73` — the reported pill: label
caption→label; badge `bg-white/25`+`text-white` deleted per recipe.
`context-panel/BottomPanel.tsx:53-54` (counts), `tool-group.tsx:128`,
`context-panel/ContextFileItem.tsx:50` (same-hue 20% tint badge),
`ScopedListRow.tsx:30` (scope chip), `messages/PlanBubble.tsx:39-41`
(green-on-green "Approved"), `messages/UserAttachments.tsx:47` (ext badge on
same-hue tint), `review/ReviewFileTree.tsx:80-83` (A/M/D/R),
`tasks type/priority chips` (`TaskCard.tsx:79,98`, `TaskListRow.tsx:101,174` —
hue on tint/dot only + dark overrides), `wf/WfStatus.tsx:160` + `WfTree.tsx:94`
+ `glyphs.ts:47` (kind chips), `settings/SettingsSidebar.tsx:64` (avatar
initial), `preview/PreviewBodyState.tsx:100` (CLICK AN ELEMENT).

### D. Semantic hue / accent-fill text

`mf-success` as text (light): `SessionRowMeta.tsx:112` (PR link),
`ChatCardHeader.tsx:91`, `editor/DiffHeader.tsx:56`, `editor/EditorTab.tsx:46,55`
(chips), `review/ReviewFileToolbar.tsx:58,65`, `ReviewPanelHeader.tsx:57,63`,
`git/BranchRow.tsx:25-32` (ahead/behind), `wf/WfYamlPane.tsx:33`,
`composer/WorktreePopover.tsx:41`. `mf-warning` as text:
`files/ChangesPanel.tsx:220`, `editor/EditorTab.tsx:264`,
`review/ReviewCommitRail.tsx:94`, `remote-access/TunnelStatusRow.tsx:60`,
`SidebarFooter.tsx:10`, `gates/GateShell.tsx:62` (warning eyebrow variant),
`wf` status tags. White-on-accent CTAs at <12px:
`FirstRunState.tsx:36`, `tour/WsTourLabel.tsx:92`, `WorktreeNewForm.tsx:189`,
`ComposerEditMode.tsx:108`, `wf/WfRunDetail.tsx:200` ("Answer now"),
`WorkflowsView.tsx:80`, `preview/PreviewRunControl.tsx:26` (Run).
`BashCard.tsx:34,66` — default output lines use `mf-term-cmt` (dimmest
terminal color) instead of `mf-term-fg`. `render-highlights.tsx:17-20` +
`read-more.tsx:73` + `ws-toast.tsx:163` — `text-primary` at ≈3:1 on light
backgrounds: acceptable for 13px+ semibold links only; smaller → darken or
underline affordance.

### E. Form-control visibility

`gates/AskQuestionWizard.tsx:67` — unselected radio ring `border-mf-text-4`
(invisible control) → `border-input`/`mf-text-3`.
`Composer.tsx:125` placeholder text-4 → text-3.
`WorktreeNewForm.tsx:159` input placeholder text-3 (keep with new value).
`review/ReviewCommitRail.tsx:113` disabled state → dedicated disabled ink.

### F. Meaningful icons < 12px (promote to 12/14 grid)

6–8px class (compressed-scale bugs): `attachment.tsx:118,187,217`,
`quote.tsx:31-32`, `directive-text.tsx:59`, `ImportSessionsDialog.tsx:167`
(`size-3`=6px), `button.tsx:13` (`[&_svg]:size-4`=8px app-wide),
`select.tsx:30,45,59,133` + `command.tsx:45,117` + dropdown/context
`:34,136,163` (8px/4px), `Composer.tsx:43` (Cancel Square 6px vs Send 14px),
`ChatThread.tsx:105` (scroll-down 8px). Clip bugs:
`wf/editor/WfEditorChrome.tsx:89` (Check 10px in 8px box),
`tasks/TaskListRow.tsx:83` (Check 9px in 8px box), `run/ConsolePane.tsx:133`
(Trash 10px in 12px button). 9–11px meaningful:
`SessionRowMeta.tsx:48,100` (9px), `SessionGroupHeader.tsx:21` (9px),
`FilesTabStrip.tsx:107` + `RunTabStrip.tsx:85` (9px close),
`ProviderModelSelect.tsx:162` + `PermissionSelect.tsx` + `EffortPicker.tsx:66-69`
(9-11px chevrons/locks), `FilterMenu.tsx:89` (9px check),
`git/BranchRow.tsx:27,32` (9px arrows), `wf/WfStatus.tsx:65` (8px X),
`review/ReviewFileTree.tsx:46` (7px meter squares), hover actions
`SessionRow.tsx:135,140,144` (11px), `SessionsNewButton.tsx:65,99` /
`SessionSortMenu.tsx:34` / `SessionsMoreMenu.tsx:51` (11-12px header
controls), `context-panel` `size={9-11}` chevrons/icons, `ws-toast.tsx:198`
(11px dismiss + `opacity-40`).

## P2 themes (fix opportunistically per surface)

- **Sibling icon-size drift**: FileTree 9/11/12; DiffHeader 11/12/13;
  ReviewPanelHeader 11/12/15/16; PreviewRunControl 10/11/13;
  PreviewUrlBar 12/13; TasksDrawer 11/13; TaskListRow vs TaskCard same actions
  at 12/13/14; toolbar chips Gauge 11 / Shield 11 / Sliders 12 / Clipboard 12 /
  GitFork 13 next to 8px attach/mention. Normalize per cluster to 12/14/16.
- **Status-dot drift**: 4px (TunnelStatusRow, NamedTunnelSection idle+opacity),
  5px (BackgroundActivityBar), 6px (ProvidersPane), 8/14/15px (tasks). Pick a
  6/8/10 grid.
- **Header hierarchy flatness**: `ChatCardHeader` title = model chip = buttons
  (all caption); `tool-group.tsx:120` uppercase-bold summary at caption;
  `CodeHeader.tsx:37` uppercase caption; `markdown-table.tsx:27,35` 12px cells;
  `syntax-highlight.tsx:17` 12px vs inline-code 11px mismatch.
- **Token drift, same semantic**: deletions `text-destructive`
  (ReviewFileToolbar:34) vs `text-mf-diff-del-text` (ReviewPanelHeader:60,
  ReviewFileTree); violet pair `bg-mf-accent-violet`+`text-mf-wf-violet`
  (WfStepLibrary:169); `badge.tsx:6` muted variant stacks `opacity-80`.
- **Small-but-passing** (size-only, promote when touched): keycaps
  (`MainToolbar.tsx:203`), branch chip (`MainToolbar.tsx:36`), UpdatePill CTA,
  eyebrows already on `muted-foreground` (`SessionSidebar.tsx:70`,
  `WelcomeState.tsx:64`, `NewSessionPickerPopover.tsx:74`,
  `TagRecolorPanel.tsx:29`), `GateButton.tsx:22` 12px gate actions,
  `PermissionGate.tsx:20-21` tool name → body/foreground,
  `TagPopover.tsx:205,210` 11px errors, `DegradedChatCard` 11px recovery
  actions, `mf-text-shimmer` running label (gradient can dip mid-animation).

## Healthy patterns — do not regress

- Titles/primary rows: `text-body`+`text-foreground` (SessionRow, task cards,
  branch rows, file trees, dialogs) — the top of the hierarchy is right.
- `muted-foreground` secondary prose (passes everywhere), dialog
  heading/body pairs, `PairingSection` 22px pairing code.
- `menu-variants.ts`: 12px rows, 13px icon default with
  `:not([class*='size-'])` override guard — the model for `button.tsx`.
- No phantom tokens and no `/opacity`-on-CSS-var anywhere (the two documented
  traps are fully respected; `chrome.tsx`/`diff.tsx` "phantom" strings are
  doc-comments).
- `FamilyTile` 13px-in-22px tool icons; `SidebarHeader` 14-15px chrome icons;
  arbitrary-px spacing used deliberately to dodge the compressed scale.
- `PreviewRunControl` Stop (bordered, foreground) and `ws-toast`
  title/description pair — correct templates.
- macOS HIG anchoring of the token scale itself (13px body) — per the
  2026-07-02 typography policy, size tokens stay HIG-based; this audit changes
  role assignment and ink values, not the HIG anchor.
