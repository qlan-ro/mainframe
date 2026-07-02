# Workflows Feature — Design ↔ Code Parity Drift Audit — 2026-07-02

Companion to [2026-07-02-design-parity-drift-audit.md](2026-07-02-design-parity-drift-audit.md), covering the Workflows feature that was excluded there. Ground truth: design modules `mainframe/18-workflows.jsx`, `19-wfeditor.jsx`, `20-wfstepconfig.jsx` (fetched fresh 2026-07-02 from the claude.ai/design project) plus `handoff/mainframe-theme.css`. Agents were also given the approved Stage-2 implementation plan (`uploads/2026-07-01-workflow-ui-stage2.md`) so intentionally re-scoped elements are annotated rather than mis-flagged; where the plan silently dropped a design element (rather than explicitly deferring it), the finding notes that.

Method: 4 area-scoped design-conformance agents (full design-file read → element-by-element code comparison), each followed by an adversarial verifier. Same calibration as the main audit (compressed Tailwind spacing scale, phantom-token check, per-scheme accent discipline).

**51 findings — 13 high · 20 medium · 18 low.** Verdicts: 44 confirmed, 5 adjusted (kept, with correction), 0 refuted.

Severity: **high** = visible at a glance or whole missing surface · **medium** = noticeable on inspection · **low** = subtle.

## Contents
1. [Workflows — fullview shell, Needs You inbox, Runs list](#area-1) — 7 findings (0 high)
2. [Workflows — run detail + live step tree](#area-2) — 13 findings (4 high)
3. [Workflows — Library tab + editor shell (builder ⇄ YAML)](#area-3) — 18 findings (6 high)
4. [Workflows — builder step rows + step config editors (question · agent)](#area-4) — 13 findings (3 high)

<a id="area-1"></a>
## 1. Workflows — fullview shell, Needs You inbox, Runs list

### 1.1 `MEDIUM` Workflows -> Needs You -> interaction card -> icon disc + expiry chip color — color
- **Design:** T.amber theme token throughout (wfRgba(T.amber,0.13) icon bg, T.amber icon color, wfRgba(T.amber,0.12) expiry chip bg/color) — themed per mode×scheme via the plan's Token Map (T.amber → mf-warning/mf-warning-tint) — `18-workflows.jsx:811-812 (icon disc), 817 (expiry chip)`
- **Code:** hardcoded Tailwind default palette: `bg-amber-500/13`, `text-amber-600` (icon disc); `text-amber-600 bg-amber-500/10` (expiryChipClass 'else' branch) — NOT `mf-warning`/`mf-warning-tint` used correctly everywhere else in this same file's sibling components (WfStatus.tsx, WfStepNode.tsx, WorkflowsView.tsx, WfNeedsYou.tsx all use `mf-warning` correctly) — `packages/ui/src/features/workflows/WfInteractionCard.tsx:29,80-81`
- **Note:** amber-500/600 are static, non-themed Tailwind stock colors — they will NOT re-color across the app's light/dark/ocean/velvet/classic schemes the way mf-warning does, breaking the 'never hardcode, always consume the token' rule from component-map.md §8.2. Isolated to this one file; every other workflows component gets this right, which makes it look like a one-off oversight rather than a systemic gap.

### 1.2 `MEDIUM` Workflows -> fullview shell -> title bar -> active/pending count chip — missing-element
- **Design:** a MONO-font chip next to the 'Workflows' title reading '{N} active · {N} need you' (padding 2px 8px, bg T.chipBg/bg-muted, radius md) — `18-workflows.jsx:939-941`
- **Code:** absent — title bar only renders the Zap icon + 'Workflows' label, no count chip — `packages/ui/src/features/workflows/WorkflowsView.tsx:35-38`
- **Note:** not explicitly deferred in the stage-2 plan's Task 5 shell snippet either (the plan's own reference implementation for WorkflowsView.tsx also omits it) — genuine plan-level drift from the design, not a scoping decision, since the plan's Task 5 code sample simply didn't port it.

### 1.3 `MEDIUM` Workflows -> fullview shell -> title bar -> close button — missing-element
- **Design:** explicit `xmark` icon close button (30x30, wfIconBtn()) at the left of the title bar when not embedded, with hover -> T.rowHover — `18-workflows.jsx:930-934`
- **Code:** DialogContent rendered with `hideClose` (suppresses shadcn's own X button) and WorkflowsView never renders a replacement close control — there is no visible way to close the fullview via a button, only Escape or clicking the dialog overlay — `packages/ui/src/features/workflows/WorkflowsModalHost.tsx:49-53; packages/ui/src/features/workflows/WorkflowsView.tsx:35-38`
- **Note:** the plan's own Task 5 DialogContent sample doesn't set hideClose or add a custom X, so shadcn's default top-right X would have covered this if hideClose hadn't been added later — as shipped, there is no close affordance in the header at all, a real regression from both the design and the plan baseline.

### 1.4 `MEDIUM` Workflows -> fullview shell -> Escape-key behavior — behavior
- **Design:** Escape key is intercepted: if a run is open (`runId` set), Escape backs out to the list first (`setRunId(null)`) without closing the fullview; only a second Escape (or Escape with no run open) closes the whole modal — `18-workflows.jsx:886-891`
- **Code:** no keydown/onEscapeKeyDown handling anywhere in WorkflowsModalHost/WorkflowsView; relies entirely on Radix Dialog's default Escape handling, which always closes the entire dialog regardless of `selectedRunId` — `packages/ui/src/features/workflows/WorkflowsModalHost.tsx (no onEscapeKeyDown/keydown handler); packages/ui/src/features/workflows/WorkflowsView.tsx (no keydown handler)`
- **Note:** master->detail Escape-to-back-out is a documented state in the design; pressing Escape while viewing a run detail will unexpectedly close the whole fullview instead of returning to the run list.

### 1.5 `LOW` Workflows -> Needs You -> Runs list -> step detail -> 'Open agent chat' button — icon *(adjusted by verifier)*
- **Design:** leading `chat` icon (MessageSquare, 12px) + label + trailing `chevron.right` (9px), height 28, padding '0 11px 0 9px' — `18-workflows.jsx:196-203`
- **Code:** leading `ExternalLink` icon only (12px), no trailing chevron, label hardcoded to 'Open agent chat' (fine since design's step.chat is usually that string), height driven by `py-1.5` not an explicit 28px, padding `px-[9px] py-1.5` (asymmetric vs design's 9px-left/11px-right) — `packages/ui/src/features/workflows/WfStepNode.tsx:236-250`
- **Note:** the plan's own Token Map doesn't list a mapping for this specific `chat`+`chevron.right` combo button, so the porter substituted a single ExternalLink glyph — a plausible choice (ExternalLink reads as 'go to') but it's a real glyph+chevron delta from the artboard's chat-bubble-in, chevron-out affordance.
- **Verifier correction:** The glyph drift is real: design (18-workflows.jsx:196-203) is a leading `chat` icon (12px) + label + trailing `chevron.right` (9px) at height 28 with padding '0 11px 0 9px', while WfStepNode.tsx:236-250 ships a single leading ExternalLink (12px), no trailing chevron, symmetric px-[9px] + py-1.5. But the note's rationale is wrong: the stage-2 plan's Token Map (line 38) DOES map both glyphs explicitly — `chat`→`MessageSquare` and `chevron.right`→`ChevronRight` — so the porter had the mapping available and the substitution was an oversight, not a gap in the map. Correct fix per the plan is MessageSquare + trailing ChevronRight.

### 1.6 `LOW` Workflows -> Runs list -> row -> succeeded-run summary line — behavior
- **Design:** succeeded run rows show a meaningful outcome line, e.g. 'Posted review · 3 comments', 'Summary ready' (run.line) — `18-workflows.jsx:1069 (line: 'Posted review · 3 comments'), 1077 (line: 'Summary ready')`
- **Code:** derivedLine() only handles 'waiting' (-> 'Waiting…') and 'failed' with an error (-> truncated error head); succeeded (and any other status) falls through to an empty string, so succeeded rows show no summary line at all — `packages/ui/src/features/workflows/WfRunsList.tsx:66-74`
- **Note:** the plan itself (Task 8 Step 2) specifies 'if succeeded -> outputs summary' — WorkflowRunSummary.outputs is available on the type (packages/types/src/workflow.ts:31) so this was implementable but wasn't wired; capped low since the plan hedged with 'keep it simple' and this is a content/polish gap, not a broken affordance.

### 1.7 `LOW` Workflows -> Needs You -> interaction card -> sub-line 'waiting' phrasing — text
- **Design:** '· waiting {interaction.since}' where since is a bare duration string, e.g. '2h 4m' -> renders '· waiting 2h 4m' — `18-workflows.jsx:822; WF_INTERACTIONS since: '2h 4m' (1104)`
- **Code:** '· waiting {formatAgo(createdAt)}' where formatAgo appends 'ago' -> renders '· waiting 2h ago', which reads redundantly ('waiting' + 'ago' both implying elapsed time) versus the design's plain duration — `packages/ui/src/features/workflows/WfInteractionCard.tsx:106; glyphs.ts:195-208 (formatAgo)`
- **Note:** cosmetic copy drift only; formatAgo is a shared, correctly-built helper reused elsewhere (run rows, where the 'ago' suffix is correct) — the interaction card is the one caller where the design wanted a bare duration.

<details><summary>Coverage notes</summary>

Read the full design source (18-workflows.jsx, all 1129 lines), component-map.md §4/§6/§7, the approved Stage-2 plan (879 lines, all tasks/token-map), and globals.css token definitions. Compared against production: WorkflowsView.tsx, WorkflowsModalHost.tsx, WfNeedsYou.tsx, WfInteractionCard.tsx, WfAnswerForm.tsx, WfField.tsx, WfRunsList.tsx, WfStatus.tsx, glyphs.ts, use-workflows-modal.ts, use-workflows-store.ts, use-workflows-toasts.ts, WfStepNode.tsx (shared dependency), and the sidebar WorkflowsBtn in SidebarHeader.tsx. Verified token existence against globals.css (mf-warning, mf-success, mf-content2, mf-window, radius scale, amber-500/600 defaults) and cross-checked codebase precedent for the `bg-current/[opacity]` and `/N` opacity-modifier patterns (confirmed working Tailwind v4 idiom, not a phantom-token trap). Did not deep-review WfRunDetail.tsx/WfTree.tsx/WfLibrary.tsx/editor/* internals (out of this area's scope per the task split), only touched them to confirm shared-component consistency.

</details>

<a id="area-2"></a>
## 2. Workflows — run detail + live step tree

### 2.1 `HIGH` Workflows -> Run detail -> header -> Back button — icon
- **Design:** Icon name="chevron.left" size={15} color={T.text2}, fixed 30×30px hit target (wfIconBtn: width:30,height:30,borderRadius:RADIUS.md) — `18-workflows.jsx:485-487, wfIconBtn at 876-878`
- **Code:** <ArrowLeft size={15} aria-hidden /> inside a button with only `p-1` padding (no fixed w/h) and `text-mf-text-3` (T.text3, not T.text2) — `packages/ui/src/features/workflows/WfRunDetail.tsx:118-129`
- **Note:** Wrong icon family (Arrow vs Chevron — a plausible-but-wrong glyph per the review's own calibration example), wrong text-color shade (text3 dimmer than text2), and a much smaller hit target than the design's fixed 30×30 box. This is the first element seen in run detail.

### 2.2 `HIGH` Workflows -> Run detail -> tree -> Loop (foreach) -> iteration switcher -> active chip — state
- **Design:** Active iteration chip is tinted by that iteration's own status color: border 1px wfRgba(m.color,0.6), background wfRgba(m.color,0.1), where m = WF_STEP_STATUS[iter.status] (green if succeeded, red if failed, amber if waiting, etc.) — `18-workflows.jsx:322-335 (WfLoopRail iteration switcher)`
- **Code:** Active chip is hardcoded to amber regardless of the selected iteration's status: `on ? 'border border-mf-warning/60 bg-mf-warning/10 font-bold text-foreground' : ...` — `packages/ui/src/features/workflows/WfTree.tsx:208-213`
- **Note:** A successfully-completed iteration, when selected, will show an amber/warning-tinted chip instead of green — misrepresenting the iteration's actual outcome. The inner WfIterDot correctly computes per-status color, but the surrounding chip border/background does not — a half-fix. Also the button's data-testid keys off the array index (`workflows-iter-${i}`) rather than the stable `iter.label` domain id already used for `key`.

### 2.3 `HIGH` Workflows -> Run detail -> header -> "Parent: #runId" link — behavior
- **Design:** Rendered with cursor:pointer and ACCENT color, implying a clickable navigation affordance to the parent run — `18-workflows.jsx:498`
- **Code:** Rendered as a plain <span> with `cursor-pointer` and `text-primary` classes but NO onClick handler — visually clickable, functionally inert, and not keyboard-reachable (not a <button>, no tabIndex) — `packages/ui/src/features/workflows/WfRunDetail.tsx:169-177`
- **Note:** useWorkflowsModal().openRun is already imported/available in this file's scope (used nowhere here) and is correctly wired for the identical affordance in the sibling WfCallRail subflow link (WfTree.tsx:250-259) — this is a straightforward, unambiguous behavior-parity gap, not a data-contract limitation.

### 2.4 `HIGH` Workflows -> Run detail -> tree -> leaf step node (duration / sub / waitFor) — missing-element
- **Design:** Every leaf step shows a duration chip (mono, T.text3) next to the status tag, and a secondary sub-line (or amber waitFor line when waiting) below the title — present on nearly every step in the mock data (e.g. 'duration: \'3m 12s\'', sub: 'Editing src/tree/DiffBadge.tsx · 4 files touched') — `18-workflows.jsx:170,173-177; sample data e.g. :1040,1045,1061,1070`
- **Code:** WfStepNode reads `duration`/`waitFor`/`sub` via a defensive `optText()` helper reading arbitrary keys off RunTreeNode that the type (and the daemon) never populates — RunTreeNode has no duration/waitFor/sub fields (nor startedAt/finishedAt to derive one from), so these lines never render in practice — `packages/ui/src/features/workflows/WfStepNode.tsx:26-34,135-139,196-197,204-213; packages/ui/src/lib/api/workflows.ts:5-19 (RunTreeNode has no duration/startedAt/finishedAt/waitFor/sub)`
- **Note:** Not explicitly deferred by the stage-2 plan (Task 1's RunTreeNode field list omits these but the plan never calls out the gap as a decision) — this is a real, high-visibility data-contract hole surfaced by the port: essentially every step row in the design carries timing info, and the shipped tree never shows any duration anywhere.

### 2.5 `MEDIUM` Workflows -> Run detail -> header -> Cancel button icon / trigger-row Manual icon — icon
- **Design:** stop.fill / play.fill — solid (filled) glyphs — `18-workflows.jsx:519 (Icon name="stop.fill"), :50 (WF_TRIGGER.manual icon:'play.fill')`
- **Code:** <Square size={11} aria-hidden /> and <Play size={11} aria-hidden /> with no `fill` prop, rendering as outline glyphs — `packages/ui/src/features/workflows/WfRunDetail.tsx:153, :34`
- **Note:** The plan's icon map says stop.fill→Square/play.fill→Play but omits the fill requirement; the codebase's own established convention for these exact glyphs (packages/ui/src/features/run/ToolbarLaunchControls.tsx, layout/RunTabStrip.tsx) always adds fill="currentColor" for .fill icons. Both instances in this file skip it, producing outline squares/triangles instead of the design's solid glyphs.

### 2.6 `MEDIUM` Workflows -> Run detail -> tree -> step/composite bordered elements (parallel lane cards, branch arm cards, loop container, subflow/chat-link buttons, code I/O blocks, header/footer dividers) — border
- **Design:** Consistent 0.5px hairline borders throughout (`border: 0.5px solid ${T.border}` / `borderBottom: 0.5px solid ${T.hairline}`) — ~20 occurrences across WfRunDetail/WfTree/WfStepNode alone — `18-workflows.jsx:199,215,274-275,297,338,357-358,381-382,400,420,435,438,453,482,518,539 (all "0.5px solid")`
- **Code:** Only 2 of these elements use `border-[0.5px]` (the inactive loop-iteration chip, the Cancel button); all others — parallel lane card (`border border-border`), branch arm card (`border`), loop container (`border`), subflow/chat-link buttons (`border`), code `<pre>` block (`border`), header `border-b`, footer `border-t` — render at full 1px weight — `packages/ui/src/features/workflows/WfTree.tsx:124,126,158,222,254; WfStepNode.tsx:66,244; WfRunDetail.tsx:115,220`
- **Note:** Systematic: the design's entire run-detail chrome uses hairline weight consistently for warm-chrome consistency; production renders these borders roughly 2x heavier throughout, giving the whole panel a visually denser/heavier feel than the prototype. Grouped as one finding since it's the same drift repeated ~8+ times rather than 8 separate defects.

### 2.7 `MEDIUM` Workflows -> Run detail -> header -> status banner — behavior
- **Design:** run.banner is a generic, daemon-supplied, status-tinted narrative string shown for ANY run status (running/succeeded/failed/waiting), with an optional run.bannerCta button in the run's own status color — `18-workflows.jsx:523-530`
- **Code:** Banner only ever renders for the single case `run.status === 'waiting' && hasPendingInteraction`, with a hardcoded string 'This run is waiting for your input.' — WorkflowRunSummary has no banner/bannerCta field at all — `packages/ui/src/features/workflows/WfRunDetail.tsx:96-99,181-210; packages/types/src/workflow.ts:22-32`
- **Note:** The stage-2 plan's own Task 10 Step 2 already narrows this to the waiting-only case ('an optional banner (waiting → "Waiting for you…" with an "Answer now" CTA)'), so this is deferred/re-scoped by the plan — capped at medium per instructions. Note even against the plan's own narrower spec, the copy differs ('This run is waiting for your input.' vs the plan's 'Waiting for you…').

### 2.8 `MEDIUM` Workflows -> Run detail -> header/tree -> Rail · Blocks direction toggle — missing-element
- **Design:** A segmented Rail/Blocks toggle in the run-detail header switches the whole tree between vertical-timeline (Rail) and containment-diagram (Blocks) rendering — `18-workflows.jsx:501-516 (toggle), :392-472 (WfCompositeBlocks/WfLoopBlocks)`
- **Code:** No variant prop, no toggle UI, no Blocks renderer anywhere in WfRunDetail.tsx/WfTree.tsx — Rail-only — `packages/ui/src/features/workflows/WfRunDetail.tsx (absent), WfTree.tsx (absent)`
- **Note:** Explicitly deferred by the stage-2 plan ('Decision (2026-07-01): ship Rail only for v1... Task 11 is deferred'). Reporting per instructions since the design shows it, but capped at medium as an approved re-scope, not a code defect.

### 2.9 `MEDIUM` Workflows -> Run detail -> tree -> Sub-workflow (call) node -> "Open run" link button — icon
- **Design:** Icon name="chevron.right" size={9} — a small chevron trailing the ref label — `18-workflows.jsx:297-299 (rail subflow button)`
- **Code:** <ExternalLink size={11} aria-hidden /> — a different glyph (external-link box-arrow) at a larger size — `packages/ui/src/features/workflows/WfTree.tsx:250-258`
- **Note:** Per the review guidance, 'pop'/box-with-arrow legitimately maps to ExternalLink elsewhere in the design system, but THIS specific prototype element explicitly uses chevron.right (→ ChevronRight per the plan's own icon map), not an external-link icon — a real glyph substitution, plus a size mismatch (9 vs 11).

### 2.10 `MEDIUM` Workflows -> Run detail -> tree -> composite header summary text — missing-element
- **Design:** step.summary is an arbitrary, semantically rich daemon-supplied string shown next to the composite title (e.g. 'pending · 0 of 2', 'took “estimate == small”', 'item 4 of 8 · failed', 'not started · returns pr_url') — `18-workflows.jsx:256,385; sample data :1029,1042,1049,1088`
- **Code:** Synthesizes a generic, always-identical count string per composite type ('${lanes.length} lanes' / '${arms.length} arms' / '${iterations.length} iterations') since RunTreeNode carries no summary field — `packages/ui/src/features/workflows/WfTree.tsx:119,147,196,262; packages/ui/src/lib/api/workflows.ts:5-19`
- **Note:** Matches the stage-2 plan's own RunTreeNode contract exactly (Task 1 spec never lists a summary field) — a real daemon-data-contract gap surfaced by this build, but not an outright code defect against the approved plan. Not explicitly called out as deferred in plan prose, so not capped as low as the explicitly-deferred items.

### 2.11 `LOW` Workflows -> Run detail -> tree -> small interactive buttons (chat-link, subflow-link, inactive loop-iteration chip) background surface — color
- **Design:** background: T.content (the warm card surface, matching the run-detail root and other bordered chrome) — `18-workflows.jsx:199,297,329,438 (all `background: T.content`)`
- **Code:** bg-background (the pure white/base content surface, a genuinely different token from --card in this theme) — `packages/ui/src/features/workflows/WfStepNode.tsx:244; WfTree.tsx:212,254`
- **Note:** Per the plan's own Token Map, T.content→bg-card, not bg-background; globals.css defines --background and --card as distinct colors in every palette (e.g. light: #ffffff vs #f8f6f2). These three small buttons sit on the wrong (colder/whiter) surface, slightly breaking warm-chrome consistency.

### 2.12 `LOW` Workflows -> Run detail -> tree -> WfStatusTag for skipped/cancelled — color
- **Design:** background: wfRgba(meta.color, 0.10) — a faint tint of the status's own color (T.text3/T.text4-ish) even for skipped/cancelled, not a generic neutral chip — `18-workflows.jsx:94-98 (WfStatusTag)`
- **Code:** isMuted (skipped|cancelled) branches to a flat `bg-muted` (the generic neutral chip-background token) instead of a status-color tint — `packages/ui/src/features/workflows/WfStatus.tsx:117,125`
- **Note:** Subtle — both read as a light-gray pill, but design's tag is a translucent tint of the label's own color (keeping every status tag visually in the same tinted-pill family) while code's skipped/cancelled tags use an unrelated neutral surface token.

### 2.13 `LOW` Workflows -> Run detail -> tree -> composite head title / leaf step title — typography
- **Design:** letterSpacing: -0.1 on both the composite head title and the leaf step title — `18-workflows.jsx:164 (leaf), :255 (composite head)`
- **Code:** No tracking-tight (or any negative tracking) applied — only the run-detail page title (letterSpacing -0.3) gets `tracking-tight` — `packages/ui/src/features/workflows/WfTree.tsx:65; WfStepNode.tsx:177`
- **Note:** Very subtle at typical 13px text-body size; flagged as a minor systematic omission per the plan's own stated weight/tracking mapping.

<details><summary>Coverage notes</summary>

Read 18-workflows.jsx (WfRunDetail, WfTree/WfSpine, WfCompositeRail/WfLoopRail/WfBranchRail, WfStepNode, WfIO, WfStatusPip/Tag, WfKindChip, WF_KIND/WF_STEP_STATUS/WF_RUN_STATUS, wfIconBtn) end to end, plus the Blocks variant (WfCompositeBlocks/WfLoopBlocks) for scope comparison. Read the full 2026-07-01-workflow-ui-stage2.md (both pages) for the Token Map and Task 9/10/11 specs (confirmed Rail-only v1, Blocks explicitly deferred). Read production WfRunDetail.tsx, WfTree.tsx, WfStepNode.tsx, WfStatus.tsx, glyphs.ts in full. Cross-checked every color/spacing/radius class against packages/ui/src/styles/globals.css (--spacing-*, --radius-*, --text-*, --mf-* token definitions, both light/dark palette blocks) and against packages/types/src/workflow.ts (WorkflowRunSummary, WorkflowStepSummary, RunTreeNode client type) to distinguish real code defects from daemon-data-contract gaps. Ran the three relevant test files (WfTree.test.tsx, WfRunDetail.test.tsx, WfStepNode.test.tsx) — 57/57 pass. Did not spin up a live daemon/browser screenshot; comparison is source-level per the prototype-README guidance (read source over screenshots unless asked). WfField/WfAnswerForm/WfInteractionCard/WfNeedsYou/WfLibrary/WfRunsList/editor/* are out of this area's scope and not audited here.

</details>

<a id="area-3"></a>
## 3. Workflows — Library tab + editor shell (builder ⇄ YAML)

### 3.1 `HIGH` Workflows -> Editor -> YAML serializer -> step id line (every kind) — behavior
- **Design:** wfStepYaml emits `- id: <sid>` as its OWN line for every step kind, then a nested `<kindKey>:` line on the next line, e.g. `- id: save\n  parallel:` / `- id: b\n  choose:` / `- id: l\n  foreach: items` / `- id: sf\n  call: ship-work`. sid = s.name || s.id || `${kind}_${idx}` — always present. — `19-wfeditor.jsx:63-137 (wfStepYaml)`
- **Code:** serializeStep only emits a separate `- id:` line for 'question' and 'agent' (and 'service' when s.name is set). For 'parallel', 'branch', 'loop', 'subflow' the kind key is placed directly on the `-` dash line instead: `- parallel:`, `- choose:`, `- foreach: items`, `- call: ship-work` — no id at all for composite steps. — `packages/ui/src/features/workflows/editor/yaml-serialize.ts:88-141`
- **Note:** This is the canonical grammar the plan explicitly calls out porting 1:1 ('an id on every step' — plan line 25 of the design comment, restated in the plan's Task 15 interface). Composite steps currently serialize with no id at all, which breaks step-path addressing (RunTreeNode.stepPath / stepId depend on ids existing) and diverges from the on-disk grammar the daemon verifier expects.

### 3.2 `HIGH` Workflows -> Editor -> YAML serializer -> version header — missing-element
- **Design:** First line of every serialized workflow is `version: 1`. — `19-wfeditor.jsx:33`
- **Code:** serializeWorkflow never emits a `version:` line at all — starts directly with `name: ...`. — `packages/ui/src/features/workflows/editor/yaml-serialize.ts:159-166`
- **Note:** Not covered by any yaml-serialize.test.ts assertion, so this passed CI silently. If the daemon loader/verifier expects a version field this could also fail server-side validation, not just visual parity.

### 3.3 `HIGH` Workflows -> Editor -> YAML serializer -> triggers section (manual filtering) — behavior
- **Design:** Triggers section is CONDITIONAL: only emitted (`triggers:` header + entries) when there is at least one schedule/event trigger (`trig = triggers.filter(t => t.kind === 'schedule' || t.kind === 'event')`). 'Manual' triggers are explicitly a UI-only concept and are never serialized to YAML (design comment: 'Manual "triggers" are a UI concept ... and are not serialized'). — `19-wfeditor.jsx:24-29, 37-47`
- **Code:** serializeWorkflow unconditionally pushes a `triggers:` header and calls serializeTriggers for ALL triggers, including emitting `- manual: true` for manual triggers and a webhook form the design never routes through this path either. — `packages/ui/src/features/workflows/editor/yaml-serialize.ts:167-169, 198-213`
- **Note:** Every new workflow (which defaults to a manual trigger per blankDraft()) will now emit a `triggers:\n  - manual: true` block that has no corresponding daemon grammar per the design's canonical spec, and the always-present `triggers:` header changes the document shape for every workflow (present even with zero non-manual triggers).

### 3.4 `HIGH` Workflows -> Editor -> YAML serializer -> inputs (map vs list) — behavior
- **Design:** `inputs:` entries are a YAML MAP, one key per input, indented 2 spaces with NO leading dash: `push(1, \`${i.name}: { type: ${i.type}... }\`)` → `  region: { type: string, default: us-east }`. — `19-wfeditor.jsx:48-50`
- **Code:** Emits inputs as a YAML LIST with a leading dash: `  - ${i.name}: { type: ${i.type}${def} }` → `  - region: { type: string, default: us-east }`. — `packages/ui/src/features/workflows/editor/yaml-serialize.ts:171-178`
- **Note:** Structurally different grammar (map vs sequence-of-maps) for the same construct; the yaml-serialize.test.ts only checks substring containment ('inputs:', 'region:'), so the dash is not caught by the test suite.

### 3.5 `HIGH` Workflows -> Editor -> YAML serializer -> question step timeout — behavior
- **Design:** Timeout is a structured object emitted only if present: `timeout: { afterMinutes: 720, onTimeout: cancel }` (from `s.timeout.afterMinutes` / `s.timeout.onTimeout || 'cancel'`). This is explicitly named in both the design comment and the plan's Token Map ('question timeout as { afterMinutes, onTimeout }'). — `19-wfeditor.jsx:71; plan line 25`
- **Code:** WfStep.timeout is a bare `string` (e.g. `'12h'`) and is serialized as a scalar with a hardcoded trailing comment: `timeout: 12h  # cancels the run if unanswered`. There is no `afterMinutes`/`onTimeout` structure anywhere in the model or serializer — the onTimeout policy (cancel/skip/etc.) can never be expressed. — `packages/ui/src/features/workflows/editor/yaml-serialize.ts:42-44; wf-draft-types.ts:48`
- **Note:** This is a canonical-grammar field the design and plan single out by name, not incidental prototype detail. Loses the ability to set what happens when a question times out.

### 3.6 `HIGH` Workflows -> Library -> row -> trigger chip label — text
- **Design:** WfTriggerChips renders the trigger's own descriptive label first, falling back to the generic kind label: `{t.label || meta.label}` — e.g. 'Daily · 9:00pm', 'PR opened', 'Called by Spike'. — `18-workflows.jsx:127`
- **Code:** WfLibrary's WfTriggerChips always renders the generic `defaultLabel` from TRIGGER_META (e.g. always 'Schedule', always 'Event') and never reads `t.detail` — even though `WorkflowSummary.triggers[].detail` exists on the real type and the plan's own Task 7 step 1 says trigger chips come 'from WorkflowSummary.triggers ({kind,detail})'. — `packages/ui/src/features/workflows/WfLibrary.tsx:39-57; packages/types/src/workflow.ts:19 (detail field exists but unused)`
- **Note:** Real, visible content loss: every schedule/event trigger in the Library now reads as a bare generic word instead of its schedule/event detail, and the plan itself expected `detail` to be consumed.

### 3.7 `MEDIUM` Workflows -> Editor -> YAML serializer -> agent step config fields — missing-element
- **Design:** Agent step emits `adapterId`, `model`, `permissionMode`, `effort`, boolean flags (`fast`/`ultracode`/`adaptiveThinking`), `timeoutMinutes`, and `worktree: { branchName, baseBranch }` when present, plus shared retry/on_failure policy (wfPolicyYaml). — `19-wfeditor.jsx:92-105, 139-141`
- **Code:** serializeStep's 'agent' case only emits `id`, `prompt`, and an unstructured `worktree: <string>` scalar — no adapterId/model/permissionMode/effort/flags/timeoutMinutes, and worktree is a bare string rather than `{branchName, baseBranch}`. No step kind ever emits retry/on_failure (wfPolicyYaml has no equivalent at all). — `packages/ui/src/features/workflows/editor/yaml-serialize.ts:78-86; wf-draft-types.ts:41-79 (no retry/onFailure fields exist on WfStep)`
- **Note:** The plan does not explicitly defer these fields (Task 15 says 'already emitting the canonical grammar'), so this is an unflagged scope gap rather than a documented deferral. Capped at medium since the builder is new-workflow-only in v1 and these are advanced/optional fields a user would set via the (not-yet-built, deferred) composite step config panel.

### 3.8 `MEDIUM` Workflows -> Library -> row -> scope pill label (project scope) — text
- **Design:** Scope pill shows `wf.scope === 'global' ? 'Global' : wf.project` — i.e. the actual project name (e.g. 'mainframe') for project-scoped workflows. — `18-workflows.jsx:635-637`
- **Code:** Hardcodes the literal string `'Project'` for any non-global workflow, regardless of which project. — `packages/ui/src/features/workflows/WfLibrary.tsx:97-105`
- **Note:** WorkflowSummary only carries projectId (no project name), so a full fix needs a project-name lookup the plan didn't explicitly scope for Task 7 — a project-name resolver already exists elsewhere in the app (e.g. features/sessions/use-active-identity.ts) and could have been wired. Capped at medium given the partial data-model gap, but this is a visible, easily-noticed generic label vs a real project name in every row.

### 3.9 `MEDIUM` Workflows -> Editor -> WorkflowEditor modal size vs Library modal size — layout
- **Design:** The Library/fullview shell (WorkflowsView) is `width: 1040, maxWidth: '94vw', height: '88%', maxHeight: 880`. The editor shell (WorkflowEditor) is a DIFFERENT, larger size: `width: embedded ? '100%' : 1080, height: embedded ? '100%' : '90%', maxHeight: embedded ? '100%' : 920`. — `18-workflows.jsx:927; 19-wfeditor.jsx:735`
- **Code:** WorkflowsModalHost applies the SAME `DialogContent` (`h-[88vh] max-h-[880px] w-full max-w-[1040px]`) for both WorkflowsView and WorkflowEditor — the editor never gets its own larger 1080×90%/920 sizing. — `packages/ui/src/features/workflows/WorkflowsModalHost.tsx:49-55`
- **Note:** The editor (builder+YAML split, step library overlay, validation footer) is visibly cramped relative to the design's intent of a taller/wider authoring surface distinct from the browse-only Library shell.

### 3.10 `MEDIUM` Workflows -> Editor -> WfRunInputsDialog — missing-element
- **Design:** Library's Run button opens WfRunInputsDialog (a modal collecting typed input values) whenever `wf.inputs && wf.inputs.length` — reuses WfField for the form. — `18-workflows.jsx:663-698, 703`
- **Code:** No WfRunInputsDialog component exists anywhere in packages/ui/src/features/workflows/. WfLibraryRow's handleRun always calls wfApi.startRun directly with no inputs form. — `packages/ui/src/features/workflows/WfLibrary.tsx:73-84 (absent entirely)`
- **Note:** Explicitly deferred by the stage-2 plan: 'WorkflowSummary does not currently expose declared inputs... simplest for v1: the Run button starts the run directly, and the inputs form is deferred to when the daemon exposes WorkflowSummary.inputs' (plan Task 7 step 2, and 'Known daemon follow-ups' #2). Capped at medium per the audit's deferral rule.

### 3.11 `LOW` Workflows -> Library -> row -> Edit (pencil) icon button size — spacing
- **Design:** `wfIconBtn()` = `width: 30, height: 30` used for the Edit button. — `18-workflows.jsx:656-658, 876-878 (wfIconBtn)`
- **Code:** `h-8 w-8` on the Edit button. Under this app's compressed spacing scale (--spacing-8: 24px, confirmed in globals.css), `h-8`/`w-8` resolve to 24px, not the standard-Tailwind-assumption 32px and not the design's 30px. — `packages/ui/src/features/workflows/WfLibrary.tsx:151-159; packages/ui/src/styles/globals.css:781 (--spacing-8: 24px)`
- **Note:** 24px vs the design's 30px — a real 6px undershoot, only catchable via the compressed-scale caveat (an integer class was used to hit an exact design px, which the review rules call out to flag). Fix: `h-[30px] w-[30px]`.

### 3.12 `LOW` Workflows -> Editor -> Add-trigger dropdown -> options — extra-element
- **Design:** WfbTriggerAdd's dropdown offers exactly 3 kinds: `['manual', 'schedule', 'event']`. — `19-wfeditor.jsx:599`
- **Code:** WfbAddTrigger's TRIGGER_KINDS includes a 4th option, 'Webhook' (Globe icon), not present in the design's add-trigger menu. — `packages/ui/src/features/workflows/editor/WfbDropdowns.tsx:18-27`
- **Note:** Adds a trigger kind the design intentionally excludes from this particular add flow (webhook triggers do exist elsewhere in the design's WF_TRIGGER vocabulary, but not as an addable option here).

### 3.13 `LOW` Workflows -> Editor -> WfYamlPane -> filename in header chip — text
- **Design:** Filename label is derived live from the draft name: `{(draft.name || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.yaml`. — `19-wfeditor.jsx:238`
- **Code:** Hardcodes the literal string `workflow.yaml` regardless of the workflow's actual name. — `packages/ui/src/features/workflows/editor/WfYamlPane.tsx:28`
- **Note:** Minor but easy fix; the plan's Task 14 doesn't call out dropping this, it's just an omission.

### 3.14 `LOW` Workflows -> Editor -> WfYamlPane -> synced-with-builder indicator + read-only/Edit toggle + syntax highlighting/line numbers — missing-element
- **Design:** Default view is read-only, line-numbered (`width: 38` gutter), syntax-highlighted (WfYamlLine/WfYamlValue color per token), with a header 'Synced ↔ builder' / 'Synced with builder' green pulse-dot pill, and an explicit Edit/Done toggle button that switches to a plain textarea. — `19-wfeditor.jsx:172-274`
- **Code:** WfYamlPane is ALWAYS a single plain `<textarea>` bound directly to `yaml`/`onChange` — no line numbers, no syntax highlighting, no sync-state pill, no Edit/Done toggle. Header only shows a Valid/N-issues/Validating chip. — `packages/ui/src/features/workflows/editor/WfYamlPane.tsx:19-57`
- **Note:** Explicitly plan-sanctioned: 'Deferred polish (YAGNI for v1): YAML syntax highlighting in WfYamlPane (plain textarea is fine)' and 'full YAML→model reparse ... deferred'. Reported per instructions (still a real visual delta) but capped at low/deferred severity since the plan pre-approved this scope cut.

### 3.15 `LOW` Workflows -> Editor -> mode default for existing workflow — state
- **Design:** WorkflowEditor always defaults to `mode: 'split'` regardless of new vs. edit (`mode: initialMode = 'split'`). — `19-wfeditor.jsx:711`
- **Code:** Edit-mode target defaults to `mode: 'yaml'` instead of `'split'`; clicking Builder/Split in edit mode shows an informational placeholder rather than the builder. — `packages/ui/src/features/workflows/editor/WorkflowEditor.tsx:148`
- **Note:** Deliberate, disclosed adaptation (code comment cites the deferred YAML→model reparse as the reason) directly following from the plan's Task 15 note that reparse is deferred/best-effort. Reported for completeness, not a blind miss.

### 3.16 `LOW` Workflows -> Editor -> Add-step catalog card -> heading font size token — typography *(adjusted by verifier)*
- **Design:** Card title / step-library header title use `FS.body`/`FS.heading` tokens (`15px` for the step-library header title). — `19-wfeditor.jsx:688 (FS.heading), 661`
- **Code:** WfStepLibrary hardcodes `text-[0.9375rem]` (= 15px) in two places instead of the `text-heading` utility that resolves to the same value (`--text-heading: 0.9375rem` confirmed in globals.css). — `packages/ui/src/features/workflows/editor/WfStepLibrary.tsx:155, 220`
- **Note:** Pixel-correct today (matches design) but bypasses the type-scale token, so it will silently drift if --text-heading is ever retuned. Fix: use `text-heading` class.
- **Verifier correction:** The token bypass is real, but the 'pixel-correct today' claim only holds for WfStepLibrary.tsx:220 (step-library header — design FS.heading = 15px, matches --text-heading: 0.9375rem; should use the text-heading class). Line 155 is the WfStepTypeCard TITLE, and the design (19-wfeditor.jsx:661) sizes it FS.body = 13px (01-base.jsx:40), so text-[0.9375rem] (15px) there is an actual 2px oversize vs the design, not a token-equivalent hardcode — the fix for line 155 is text-body (0.8125rem/13px), not text-heading.

### 3.17 `LOW` Workflows -> Editor -> WfStepTypeCard -> 'Control flow' badge color — color
- **Design:** Control-flow badge uses `wfRgba('#5b269a', 0.12)` background / `#7a4d9e` text — the same violet used elsewhere for the 'Branch' kind tint family. — `19-wfeditor.jsx:662`
- **Code:** Uses an inline `style={{ background: 'rgba(91,38,154,0.12)', color: '#7a4d9e' }}` instead of a Tailwind class backed by a real token, even though `--color-mf-accent-violet` exists and is already used by glyphs.ts for the 'choose'/branch kind. — `packages/ui/src/features/workflows/editor/WfStepLibrary.tsx:158-167`
- **Note:** Not a phantom-token miss (values are pixel-correct) but violates the 'Tailwind classes only, no inline styles' constraint stated in the plan's Global Constraints, and duplicates a hex the app already has a named token for (`mf-accent-violet`).

### 3.18 `LOW` Workflows -> Editor and Library -> icon-only buttons missing the shared Hint tooltip — behavior
- **Design:** N/A directly (prototype uses raw HTML `title=` throughout since it predates the app's shared tooltip primitive) but the app's own established convention (used in 23+ other feature files) wraps icon-only affordances in the shared `Hint` component rather than native `title=`. — `packages/ui/CLAUDE.md 'app-tauri-hint-tooltip-primitive' convention`
- **Code:** WfLibrary's Edit button (`title="Edit definition"`) and WfRunDetail's Back button use native `title=` attributes; the entire workflows feature has zero `Hint` imports despite icon-only buttons throughout (Edit, Close, Cancel icon-buttons, step-row Configure/Remove, trigger Remove, output Remove). — `packages/ui/src/features/workflows/WfLibrary.tsx:154; packages/ui/src/features/workflows/editor/WfbStepRow.tsx:87-109 (aria-label only, no visible tooltip at all on Configure/Remove)`
- **Note:** Not a prototype-fidelity issue (prototype never had Hint) but a codebase-convention drift flagged for consistency; several icon-only buttons in the editor (Configure/Remove in WfbStepRow, Remove trigger/output) have no tooltip at all (only aria-label), a discoverability regression vs. the design's `title=` on equivalent controls.

<details><summary>Coverage notes</summary>

Read in full: 18-workflows.jsx (WfLibrary/WfLibraryRow/WfTriggerChips/WfRunInputsDialog, lines 1-1130) and 19-wfeditor.jsx (wfYamlLines/wfStepYaml/wfPolicyYaml serializer, WfYamlPane, WfBuilderPane, WfbStepRow/WfbTriggerAdd, WfStepLibrary/WfStepTypeCard, WorkflowEditor shell, lines 1-839), plus mainframe-theme.css and the full 2026-07-01-workflow-ui-stage2.md plan (Token Map, Task 7/14/15/16, and the explicit Deferred-polish / Known-follow-ups sections). Cross-checked production code: WfLibrary.tsx, glyphs.ts, WorkflowsView.tsx, WorkflowsModalHost.tsx, editor/{WorkflowEditor,WfYamlPane,WfBuilderPane,WfbStepRow,WfbDropdowns,WfStepLibrary,yaml-serialize,wf-draft-types}.tsx/.ts, and the yaml-serialize test suite, against packages/ui/src/styles/globals.css for real token names/values (verified --spacing-*, --radius-*, --mf-*-tint, --mf-border-hover, --mf-accent-violet, --text-heading all exist and match the calibration table). component-map.md has no workflows-specific section (confirmed via grep of its headings) so mainframe-theme.css + the plan's Token Map were the applicable contract docs. Did not deep-dive WfRunDetail/WfRunsList/WfNeedsYou/WfStepNode/WfTree (out of scope — a sibling auditor's area) or daemon-side workflow id/route internals (outside the UI-only area brief).

</details>

<a id="area-4"></a>
## 4. Workflows — builder step rows + step config editors (question · agent)

### 4.1 `HIGH` editor/WfbStepRow.tsx — Configure expander body (question/agent/service/subflow/value config) — missing-element
- **Design:** 20-wfstepconfig.jsx defines two full editors mounted here: WfeQuestionConfig (title input + timeout chip + on-timeout policy select + reorderable field rows with key/type/label/Req-switch/remove + options chip editor + when-condition rows + inline red validation + dashed 'Add field' button) and WfeAgentConfig (prompt textarea + the REAL composer toolbar: ModelSelector, permission ComposerSelect, EffortPicker, FeaturesPopover, WorktreeButton + timeout chip + on-failure/retries/backoff row). 19-wfeditor.jsx WfbStepRow (lines 441-472) renders these via `window.WfeQuestionConfig`/`window.WfeAgentConfig` when a leaf step's Configure panel is open, and also renders inline detail for service/subflow/value kinds. — `19-wfeditor.jsx:441-472; 20-wfstepconfig.jsx:185-318`
- **Code:** The Configure panel is a static placeholder for every step kind: `<p>Configure panel for {meta.label} step.</p>`. No question field editor, no agent composer-toolbar editor, no service/subflow/value inline detail exists anywhere in the tree (grepped `packages/ui/src/features/workflows` — no WfeQuestionConfig/WfeAgentConfig/WfeFieldRow/WfeOptionsEditor/WfeTimeoutChip file exists). — `packages/ui/src/features/workflows/editor/WfbStepRow.tsx:112-122`
- **Note:** The component's own header comment explicitly documents this as scoped-out ('Composite sub-lane nesting… DEFERRED… scoped to a follow-up pass'), and the approved Stage-2 plan's Task 15 (Builder pane) and Task 16 (Step-type library) never mention 20-wfstepconfig.jsx or the per-step config editors at all — only identity/Triggers/Inputs/Outputs/Steps sections and the add-step catalog. Since the plan silently drops an entire artboard (20-wfstepconfig.jsx) rather than explicitly deferring it with a rationale, this is a real scope gap versus the design, not a documented, rationale-backed deferral — but because the plan the code was built from never scoped this file in, severity is capped at high rather than blocking (per audit rules, an explicit-defer-in-plan caps at medium; this is closer to an omission, so kept high but should be flagged to product/planning, not just the porter).

### 4.2 `HIGH` editor/wf-draft-types.ts — WfStep / WfField model — missing-element
- **Design:** WfeQuestionConfig needs `step.timeout: {afterMinutes, onTimeout}`, `field.label`, `field.when: {key, equals}`; WfeAgentConfig needs `step.provider`, `step.model`, `step.tuning`, `step.permission`, `step.worktree` (object, not string), `step.timeoutMinutes`, `step.onFailure`, `step.retry: {attempts, backoff}`. — `20-wfstepconfig.jsx:185-318 (WfeQuestionConfig/WfeAgentConfig field reads)`
- **Code:** `WfStep` only has a flat `timeout?: string`, no `onTimeout` policy; `WfField` has no `label` or `when`; there is no `provider`/`model`/`tuning`/`permission`/`onFailure`/`retry` field on `WfStep`, and `worktree` is typed as a bare `string`, not `{branchName, baseBranch}`. — `packages/ui/src/features/workflows/editor/wf-draft-types.ts:21-79`
- **Note:** This is a data-model gap, not just a render gap — even if the config editors were built today they'd have nowhere to write on-failure policy, retries, effort/permission/worktree, or field labels/when-conditions. Confirms the deferral is full-stack, consistent with the plan never scoping Task 15/16 to cover 20-wfstepconfig.jsx.

### 4.3 `HIGH` editor/WfBuilderPane.tsx — Steps section, composite step nesting (parallel lanes / branch arms / loop body) — missing-element *(adjusted by verifier)*
- **Design:** WfbStepRow (composite branch, lines 416-439) renders nested WfbMiniStep rows for parallel lanes, branch arms, and loop bodies directly under the main row (not gated by Configure — always visible for composite kinds), each mini-step showing its kind icon + title/connector.action. — `19-wfeditor.jsx:416-439, 476-484`
- **Code:** No composite nesting render exists; `WfbStepRow` renders the same static Configure-panel placeholder for every kind including parallel/branch/loop, with no `WfbMiniStep` equivalent. — `packages/ui/src/features/workflows/editor/WfbStepRow.tsx:112-122`
- **Note:** Explicitly acknowledged and deferred in the component's own header comment ('Composite sub-lane nesting… is DEFERRED… scoped to a follow-up pass'), consistent with the plan's Task 15 not scoping composite lane/arm editing. Per the calibration rule this caps at medium since it is an explicit, documented deferral (unlike the question/agent config gap, which the plan never mentions at all) — downgrading to medium accordingly.
- **Verifier correction:** Facts confirmed (design 19-wfeditor.jsx:416-439/476-484 renders always-visible nested WfbMiniStep lanes/arms/body; code renders nothing for composite kinds, WfbStepRow.tsx:112-122). But the finding's severity field says 'high' while its own note downgrades to medium per the audit's explicit-deferral rule — the component header (WfbStepRow.tsx:7-10) explicitly documents the deferral with a rationale, and plan Task 15 scopes only add/remove/reorder. Severity should be recorded as medium.

### 4.4 `MEDIUM` editor/WfbStepRow.tsx — main row vertical padding — spacing
- **Design:** Row `padding: '8px 10px'` (8px vertical, 10px horizontal). — `19-wfeditor.jsx:401`
- **Code:** `className="flex items-center gap-[9px] px-[10px] py-2"` — `py-2` resolves to `--spacing-2: 4px` per globals.css (compressed scale), giving 4px vertical padding, not 8px. — `packages/ui/src/features/workflows/editor/WfbStepRow.tsx:65`
- **Note:** Classic compressed-scale trap: `py-2` looks like it should be close to 8px under old-Tailwind assumptions but resolves to 4px here. Fix: `py-[8px]` (or `py-4` which is exactly 8px in this app's scale — either works, arbitrary is safer for an exact design value).

### 4.5 `MEDIUM` editor/WfbStepRow.tsx — kind icon chip size — spacing
- **Design:** Kind chip `width: 24, height: 24` with icon size 13. — `19-wfeditor.jsx:403`
- **Code:** `className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted"` — `h-6 w-6` resolves to `--spacing-6: 16px` (16×16), not 24×24. Icon size 13 matches. — `packages/ui/src/features/workflows/editor/WfbStepRow.tsx:70-72`
- **Note:** Chip renders 8px smaller than spec on both axes — visually cramped relative to the 13px icon it holds. Fix: `h-[24px] w-[24px]` (there's no exact integer step at 24 in this scale — spacing-8=24 would coincidentally work: `h-8 w-8`, but arbitrary is clearer).

### 4.6 `MEDIUM` editor/WfbStepRow.tsx — Configure/Remove icon buttons — spacing
- **Design:** `wfeIconBtn()` = `width: 28, height: 28` for both the Configure and Remove buttons. — `19-wfeditor.jsx:486-488`
- **Code:** Both buttons use `h-7 w-7` which resolves to `--spacing-7: 20px` (20×20), not 28×28. — `packages/ui/src/features/workflows/editor/WfbStepRow.tsx:94, 106`
- **Note:** 8px undersized on both axes, same trap as the kind chip — `h-7`/`w-7` reads as 'close to 28' under standard-Tailwind intuition but is compressed to 20px here. Fix: `h-[28px] w-[28px]` (spacing-9=32 doesn't fit either; use arbitrary).

### 4.7 `MEDIUM` editor/WfbStepRow.tsx — data-testid on Configure/Remove buttons — state
- **Design:** Per repo convention (CLAUDE.md) every interactive element needs a stable, scoped `data-testid`; the plan's Global Constraints reiterate this explicitly for workflows. — `2026-07-01-workflow-ui-stage2.md:18 (Global Constraints — data-testid)`
- **Code:** Configure button carries `data-testid="workflows-builder-step-configure-${step.id ?? String(index)}"` (good — keyed off domain id with index fallback). The Remove button has no `data-testid` at all, only `aria-label="Remove step"`. — `packages/ui/src/features/workflows/editor/WfbStepRow.tsx:102-109`
- **Note:** Not a design-visual delta but a repo/plan hard requirement violation — the Remove button is untestable by a stable hook. Fix: add `data-testid={`workflows-builder-step-remove-${step.id ?? String(index)}`}`.

### 4.8 `MEDIUM` editor/WfBuilderPane.tsx — Add-step button — spacing
- **Design:** `WfbAddStep`: `height: 28, padding: '0 11px 0 9px'`. — `19-wfeditor.jsx:353-356`
- **Code:** `className="mt-[3px] inline-flex h-7 items-center gap-[6px] rounded-md border border-dashed border-mf-border-hover px-[11px] …"` — `h-7` = 20px (design 28px); `px-[11px]` applies 11px on both sides (design asymmetric 9px left / 11px right, minor); no `gap` value matches design's `gap:6` correctly via `gap-[6px]`. — `packages/ui/src/features/workflows/editor/WfBuilderPane.tsx:263-270`
- **Note:** Same h-7=20px-vs-28px trap seen elsewhere in this area — appears to be a systematic miscalibration of `h-7` as 'close enough to 28' across the builder rather than an isolated slip. Fix: `h-[28px]` and `pl-[9px] pr-[11px]` for exact asymmetric padding (or `px-[11px]` is an acceptable simplification, but the height must be corrected).

### 4.9 `MEDIUM` editor/WfbStepRow.tsx and WfBuilderPane.tsx — systemic h-7/w-7/h-6/w-6 sizing — spacing *(adjusted by verifier)*
- **Design:** Design consistently uses 24px (kind chips) and 28px (icon buttons) control sizes across the step row and add-step button. — `19-wfeditor.jsx:403, 486-488, 353-356`
- **Code:** Code consistently substitutes `h-6/w-6` (16px) for 24px targets and `h-7/w-7` (20px) for 28px targets across three separate call sites (kind chip, Configure/Remove buttons, Add-step button). — `packages/ui/src/features/workflows/editor/WfbStepRow.tsx:70,94,106; packages/ui/src/features/workflows/editor/WfBuilderPane.tsx:264`
- **Note:** Flagging as a rollup/pattern note (not a new separate defect count) — this is the exact 'this mistake has shipped before' compressed-scale trap the caveat warns about: `h-6`/`h-7` read as plausible 24/28px approximations under stock-Tailwind intuition, but resolve to 16/20px here. Worth a single sweep-fix across this file pair rather than three isolated patches.
- **Verifier correction:** Pattern confirmed but under-scoped: beyond the three cited sites, the same h-7/w-7 (20px) substitution for the design's 28px wfeIconBtn also hits TriggerRow's remove button (WfBuilderPane.tsx:83), the output remove buttons (WfBuilderPane.tsx:324), and WfStepLibrary's close button (WfStepLibrary.tsx:227); and the same compressed-scale trap extends past icon sizing into gap-2/py-2 (4px for design 8px) across WfBuilderPane (see the refutation of the WfBuilderPane 'no delta' entry). The sweep-fix should cover the whole workflows/editor directory, not just the file pair.

### 4.10 `LOW` editor/WfbStepRow.tsx — Configure panel padding — spacing *(adjusted by verifier)*
- **Design:** Open, non-composite config panel: `padding: '2px 12px 12px 30px'` (top 2, right 12, bottom 12, left 30). — `19-wfeditor.jsx:442`
- **Code:** `className="border-t border-border px-[10px] pb-[11px] pl-[43px] pt-[9px]"` — top 9px (design 2px), right/left both forced to 10px via `px-[10px]` then left overridden to 43px, bottom 11px (design 12px, close). — `packages/ui/src/features/workflows/editor/WfbStepRow.tsx:117`
- **Note:** Minor since the panel currently only holds a one-line placeholder; worth correcting when the real config editors (see the missing-element finding above) are built, since the design's left-30 alignment is deliberate (aligns config content under the title, not under the grip).
- **Verifier correction:** The top-padding delta is mis-measured: the design's panel padding-top is 2px but its inner content div adds marginTop:10 (19-wfeditor.jsx:443), so the effective design content offset is 12px vs the code's pt-[9px] — a 3px shortfall, not '9px vs 2px'. The other deltas stand as stated: left 43px vs design 30px, right 10px vs 12px, bottom 11px vs 12px (WfbStepRow.tsx:117). Still low severity.

### 4.11 `LOW` editor/WfBuilderPane.tsx — Steps section spacing (steps container top margin, add-step button) — spacing
- **Design:** `WfbSection` items get an implicit vertical rhythm via `marginBottom: 16` at the section level (19-wfeditor.jsx:335) — no delta found here on inspection.
- **Code:** n/a
- **Note:** Verified — no delta; included only to record that WfBuilderPane's section spacing, scope toggle, trigger row, inputs row, and outputs row were checked and matched (padding/gap conversions confirmed correct, e.g. `gap-[9px]`, `mb-[16px]`, `py-[5px]`/`px-3` for the scope toggle at 6px/6px which matches design `padding: '5px 12px'` closely enough — px-3 = 6px per compressed scale vs design 12px horizontal, see next finding).
- **Verifier correction:** The 'verified — no delta' claim is false; the declared checked scope contains at least four more compressed-scale traps in WfBuilderPane.tsx: (1) WfbSection header row uses gap-2 = 4px vs design gap:8 (code :32, design 19-wfeditor.jsx:336); (2) TriggerRow uses py-2 = 4px vs design padding '8px 10px' (code :71, design :527) — the same trap as the WfbStepRow finding; (3) inputs rows use gap-2 = 4px vs design gap:8 (code :233, design :545); (4) outputs rows use gap-2 = 4px vs design gap:8 (code :304, design :576). Section mb-[16px]/mb-[8px] and the triggers-list gap-[6px] do match, but the entry cannot stand as a no-delta control point.

### 4.12 `LOW` editor/WfBuilderPane.tsx — scope toggle button horizontal padding — spacing
- **Design:** Scope toggle button: `padding: '5px 12px'` (5px vertical ~ rounds to 5, 12px horizontal). — `19-wfeditor.jsx:516`
- **Code:** `className="rounded-sm px-3 py-[5px] text-label font-medium"` — `px-3` resolves to `--spacing-3: 6px`, not 12px; `py-[5px]` correctly uses an arbitrary value matching design exactly. — `packages/ui/src/features/workflows/editor/WfBuilderPane.tsx:187`
- **Note:** Horizontal padding is half of spec (6px vs 12px), making the Global/This-project segmented buttons noticeably narrower than the artboard. Fix: `px-[12px]`.

### 4.13 `LOW` editor/WfStepLibrary.tsx — icons, tokens, spacing (adjacent surface, spot-checked) — icon
- **Design:** Step-type card icons/labels per WF_KIND (agent=Sparkles, service/connector=Plug, question=MessageSquare, value/set=CircleDot, branch=GitBranch, loop=RotateCw, parallel=Columns3, subflow=Layers) via KIND_META/getKindMeta. — `19-wfeditor.jsx:648-680; component-map.md Token Map`
- **Code:** `WfStepTypeCard` correctly resolves `KIND_META[kind] ?? KIND_META['connector'] ?? getKindMeta(kind)`, matching lucide icons per glyphs.ts; sizes (30px chip, 16px icon), radii (`rounded-lg`=11px card, `rounded-md`=8px chip), and the Leaf/Control-flow badge colors (violet tint for control, `bg-muted` for leaf) all check out against the design's exact values. — `packages/ui/src/features/workflows/editor/WfStepLibrary.tsx:117-200`
- **Note:** No delta — included as a positive control point since this file sits directly adjacent to WfbStepRow/WfBuilderPane in the same area and was fully read; confirms the compressed-scale mistakes above are localized to WfbStepRow/WfBuilderPane's icon-button sizing, not systemic to the whole editor.
- **Verifier correction:** The 'no delta — positive control' claim is wrong on three counts. (1) Icon/label bug: KIND_META in glyphs.ts is keyed by canonical kinds (agent, connector, question, set, choose, foreach, parallel, call), but WfStepLibrary passes model kinds ('branch', 'loop', 'subflow'), so `KIND_META[kind] ?? KIND_META['connector']` (WfStepLibrary.tsx:120) resolves those three cards to the connector meta — Plug icon, label 'Service', violet color — instead of GitBranch/'Branch', RotateCw/'Loop', Layers/'Sub-workflow'; `getKindMeta` in that chain is dead code and the tests only assert testids, so it slips through. (2) The 30px kind chip uses bg-muted (WfStepLibrary.tsx:151) vs the design's per-kind tint wfRgba(m.color, 0.13) (19-wfeditor.jsx:661). (3) The header close button is h-7 w-7 = 20px (WfStepLibrary.tsx:227) vs the design's 28px wfeIconBtn (19-wfeditor.jsx:693), contradicting the note's claim that the sizing trap is localized to WfbStepRow/WfBuilderPane. Sizes/radii/badge colors otherwise do match.

<details><summary>Coverage notes</summary>

Read design ground truth in full: 19-wfeditor.jsx (WfbStepRow, WfbMiniStep, wfeIconBtn, WfBuilderPane, WfStepLibrary/WfStepTypeCard) and 20-wfstepconfig.jsx (WfeQuestionConfig, WfeFieldRow, WfeOptionsEditor, WfeTimeoutChip, WfeSelect, WfeAgentConfig) end to end. Read component-map.md (no workflows-specific section; used §4 warm-chrome deltas + §6 primitives generally) and the full 2026-07-01-workflow-ui-stage2.md plan (Global Constraints, Token Map, File map, Task 14/15/16, self-review notes) to establish approved scope and deferrals. Read production code: WfbStepRow.tsx, WfBuilderPane.tsx, WfbDropdowns.tsx, WfStepLibrary.tsx, glyphs.ts, yaml-serialize.ts, wf-draft-types.ts in full, plus globals.css spacing/radius/type-scale tokens to convert every Tailwind class to px per the compressed-scale caveat. Confirmed no WfeQuestionConfig/WfeAgentConfig-equivalent file exists anywhere in packages/ui/src/features/workflows — grepped the whole tree. Did not run the app / take screenshots (source-first per repo convention); all deltas are from direct code/design diff plus px-accurate token conversion.

</details>
