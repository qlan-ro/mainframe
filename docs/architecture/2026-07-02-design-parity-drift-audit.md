# Design ↔ Code Parity Drift Audit — 2026-07-02

Deep parity audit of `packages/ui` (branch `feat/app-tauri-wt`) against the claude.ai/design prototype (project `63fecfba`, fetched 2026-07-02). Ground truth: `mainframe/01–17-*.jsx` + `handoff/mainframe-theme.css` + `handoff/component-map.md` + `handoff/prompt-sidebar-panel-headers.md`. Modules 01–04 and 17 were re-fetched fresh (the repo `docs/design-reference` snapshot from 2026-06-14 had drifted there); all other modules verified identical to the snapshot. Workflows (modules 18–20) excluded by request.

Method: 15 area-scoped design-conformance agents (full design-file read → element-by-element code comparison), each followed by an adversarial verifier re-reading every cited design/code line. Agents calibrated for the compressed Tailwind spacing scale and phantom `mf-*` token traps.

**243 findings — 39 high · 92 medium · 112 low.** Verdicts: 220 confirmed, 23 adjusted (kept, with correction), 0 refuted.

Severity: **high** = visible at a glance (wrong text/color, missing element, wrong position) · **medium** = noticeable on inspection · **low** = subtle (1px, tracking, hover nuance).

## Contents
1. [Left Sidebar — chrome + sessions list](#area-1) — 16 findings (3 high)
2. [Left Sidebar — bottom panel (Context / Skills / Agents tabs)](#area-2) — 14 findings (4 high)
3. [Add Project — Directory Picker modal](#area-3) — 32 findings (7 high)
4. [Transcript — assistant turns, markdown, code blocks, thread chrome](#area-4) — 15 findings (3 high)
5. [Transcript — tool cards + tool groups + system markers](#area-5) — 13 findings (3 high)
6. [Transcript — interactive gate cards (Question, Permission, Plan)](#area-6) — 18 findings (4 high)
7. [Transcript — user message states](#area-7) — 13 findings (2 high)
8. [Composer — input shell + config toolbar](#area-8) — 8 findings (0 high)
9. [Right Inspector — Tasks drawer + Tasks board/list + task modal](#area-9) — 18 findings (4 high)
10. [Popovers — branch switcher, worktrees, tags, context menus](#area-10) — 14 findings (2 high)
11. [Viewers + editor chrome + Review Changes panel](#area-11) — 15 findings (3 high)
12. [Window states — toasts, connection overlay, tutorial, error state](#area-12) — 9 findings (0 high)
13. [Daemon connection — footer status, picker, pairing dialogs](#area-13) — 20 findings (0 high)
14. [Settings modal + command palette](#area-14) — 20 findings (2 high)
15. [Global chrome — toolbar, surface rail, tabs, session bar, window styles](#area-15) — 13 findings (2 high)
16. [Primitives + theme token contract](#area-16) — 5 findings (0 high)

<a id="area-1"></a>
## 1. Left Sidebar — chrome + sessions list

### 1.1 `HIGH` Sidebar → Bottom panel → Context/Skills/Agents tab bar (BottomPanel.tsx) — color
- **Design:** Sidebar T.chipBg / T.text2 tokens (02-chrome.jsx:32,44,552 — theme tokens that DO exist in the prototype's token file)
- **Code:** className uses `hover:bg-mf-hover`, `text-mf-text-2`, and `bg-mf-hover` — none of these are defined anywhere in globals.css's `@theme`/`:root` blocks (only `--mf-text-3`/`--mf-text-4`/`--mf-chip` exist, no `--mf-hover` or `--mf-text-2`). Tailwind silently drops these classes → the inactive tab icon/label/count-badge render with NO color/background at all (falls through to inherited black/transparent). — `packages/ui/src/features/context-panel/BottomPanel.tsx:44,47,49`

### 1.2 `HIGH` Sidebar → Bottom panel → Context tab body chrome (ContextFileItem, ContextSection, ScopedListRow) — color
- **Design:** same phantom-token class of bug as above — hover rows and scope/count badges should use a real hover/muted token
- **Code:** `hover:bg-mf-hover`, `bg-mf-hover`, `text-mf-text-2` used repeatedly — same non-existent tokens, same silent-drop failure — `packages/ui/src/features/context-panel/ContextFileItem.tsx:26,30; ContextSection.tsx:29,31; ScopedListRow.tsx:21,30`

### 1.3 `HIGH` Sidebar header → Update pill — missing-element
- **Design:** Accent-tinted "Install update — vX.X.X is available" pill (download-arrow icon + "Update" label, `background: ${ACCENT}14`, height 22) sits between the traffic lights and the trailing icon cluster. — `02-chrome.jsx:666-684; component-map.md §2 row "Update pill" and §9.3`
- **Code:** SidebarHeader renders TrafficLightsSpacer → flex-1 spacer → Workflows/Tasks/Settings/hairline/Hide-sidebar. No update-pill component exists anywhere in layout/ or features/ (an updater bridge exists in lib/tauri/ but nothing renders the chrome pill). — `packages/ui/src/layout/SidebarHeader.tsx:87-105`

### 1.4 `MEDIUM` Sidebar → Bottom panel → Context/Skills/Agents tab bar container — layout
- **Design:** The 3 tabs sit inside a segmented-control chip: `padding:2, gap:2, borderRadius:7, background: T.chipBg` (02-chrome.jsx:977-980), giving the whole row a visibly inset warm-chip background behind the active/inactive buttons. — `02-chrome.jsx:973-1007`
- **Code:** Tab buttons are laid out directly in the row (`flex items-center gap-0.5 px-2 py-1`) with no wrapping chip/background container — only the active button gets `bg-mf-tab-active`; there is no `bg-mf-chip` segmented-control shell around the group. — `packages/ui/src/features/context-panel/BottomPanel.tsx:31`

### 1.5 `MEDIUM` Session row → StatusDot → 'working' spinner ring size — spacing
- **Design:** `width: 8, height: 8` spinner ring, `border: 1.5px solid ${ACCENT}` (02-chrome.jsx:365-372). — `02-chrome.jsx:365-372`
- **Code:** `dotClass()` returns `'size-2 border-[1.5px] border-primary border-t-transparent animate-spin'`. Per this app's compressed spacing scale (globals.css `--spacing-2: 4px`), `size-2` resolves to 4px × 4px, not 8px — the spinner ring renders at HALF the design size. — `packages/ui/src/features/sessions/sidebar/SessionRow.tsx:39-40`

### 1.6 `MEDIUM` Session row → StatusDot → 'waiting' solid amber pip (seen/non-unread) — spacing
- **Design:** Solid pip `width: 9, height: 9` (02-chrome.jsx:386-390). — `02-chrome.jsx:386-390`
- **Code:** `dotClass()` returns `'size-2 bg-mf-warning'` for the non-unread waiting case — `size-2` = 4px (compressed scale), not 9px. (The unread/ping-halo waiting variant correctly uses `size-[9px]` a few lines away — only the plain seen-pip path has the bug.) — `packages/ui/src/features/sessions/sidebar/SessionRow.tsx:41-44`

### 1.7 `MEDIUM` Sidebar footer → horizontal padding — spacing
- **Design:** `padding: '0 12px'` on the footer row (02-chrome.jsx:1077). — `02-chrome.jsx:1075-1079`
- **Code:** `className="flex h-[25px] flex-shrink-0 items-center gap-2 px-3 ..."` — `px-3` resolves to 6px (compressed `--spacing-3`), not 12px. — `packages/ui/src/layout/SidebarFooter.tsx:16-19`

### 1.8 `MEDIUM` Sidebar → "Add project" dashed pill → border token — color
- **Design:** `border: '1px dashed ${T.borderH}'` — the stronger hover-border token (`rgba(0,0,0,0.14)`, mapped to `--mf-border-hover` in globals.css), not the plain hairline. — `02-chrome.jsx:840-846`
- **Code:** `border border-dashed border-border` uses `--border` (`rgba(0,0,0,0.08)`), the lighter plain hairline token, instead of `border-mf-border-hover`. — `packages/ui/src/features/sessions/sidebar/ProjectFilterPillBar.tsx:115`

### 1.9 `LOW` Sidebar → Sessions group header → leading chevron — extra-element
- **Design:** The actual "Sessions group header" rendered inside `Sidebar()` has NO chevron — just `"Sessions" span + count span + flex spacer + icon cluster` (02-chrome.jsx:711-719). The chevron only exists on the separate, unused `SidebarGroup` generic component (lines 1140-1161), which is never invoked by `Sidebar()`. — `02-chrome.jsx:711-720 vs 1140-1161`
- **Code:** `SessionsGroupHeader` renders a `ChevronDown` icon before the "Sessions" label that the artboard's actual header does not have. — `packages/ui/src/features/sessions/sidebar/SessionSidebar.tsx:64-73`

### 1.10 `LOW` Sidebar footer → gap between working/waiting/idle count clusters — spacing
- **Design:** The count-cluster wrapper span uses `gap: 9` between the working/waiting/idle groups (02-chrome.jsx:1091). — `02-chrome.jsx:1089-1091`
- **Code:** All footer children (DaemonFooterStatus, spacer, and each per-status Tooltip span) share one flat `gap-2` (4px) on the outer flex container — the inter-cluster gap is 4px instead of 9px. — `packages/ui/src/layout/SidebarFooter.tsx:18,22-32`

### 1.11 `LOW` Sidebar footer → gap between status dot and its count number — spacing
- **Design:** Each status group uses `gap: 4` between the 6px dot and the count digit (02-chrome.jsx:1093,1099,1105). — `02-chrome.jsx:1092-1109`
- **Code:** `<span className="flex items-center gap-1 tabular-nums">` — `gap-1` is an integer utility = 2px (compressed `--spacing-1`), not 4px. — `packages/ui/src/layout/SidebarFooter.tsx:25`

### 1.12 `LOW` Sidebar footer → per-status count text color/weight — color
- **Design:** Each count span carries its own color + `fontWeight: 600`: working = `T.text2`, waiting = `T.amber`, idle = `T.text3` (02-chrome.jsx:1093,1099,1105), so the numbers are visually color-coded and bold. — `02-chrome.jsx:1092-1109`
- **Code:** `COUNT_META` only supplies a dot color class; the count number and label inherit the footer's flat `text-mf-text-3` with no font-weight override — all three counts render in the same plain gray, regular weight (no `text-mf-warning`/`text-primary`/`font-semibold` on the digits). — `packages/ui/src/layout/SidebarFooter.tsx:8-12,25-28`

### 1.13 `LOW` Sidebar → "Add project" dashed pill → font weight — typography
- **Design:** `fontWeight: 600` (02-chrome.jsx:844). — `02-chrome.jsx:840-850`
- **Code:** `text-caption font-medium` — font-medium is weight 500, not 600. — `packages/ui/src/features/sessions/sidebar/ProjectFilterPillBar.tsx:110-119`

### 1.14 `LOW` Sidebar → project chip (SessionRowMeta, 'All' view) — color
- **Design:** Background tint `hexToRgba(pc, 0.10)` — 10% alpha (02-chrome.jsx:475). — `02-chrome.jsx:471-481`
- **Code:** `color-mix(in oklch, ${chipColor} 12%, transparent)` — 12% instead of 10%; also artboard padding is asymmetric `'0 6px 0 5px'` with 0 vertical padding (height fixed at 15) vs production's symmetric `px-1.5 py-px`. — `packages/ui/src/features/sessions/sidebar/SessionRowMeta.tsx:56-60`

### 1.15 `LOW` Sidebar → "+N more" / "Less" collapse toggle (projects + tags rows) — icon
- **Design:** When expanded, shows a `chevron.down` icon rotated 180° next to the "Less" label (02-chrome.jsx:831-836, 940-945). — `02-chrome.jsx:823-839, 932-948`
- **Code:** Both `ProjectFilterPillBar` and `TagFilterBar` render only the text "Less"/"+N more" with no chevron icon at all. — `packages/ui/src/features/sessions/sidebar/ProjectFilterPillBar.tsx:121-131; packages/ui/src/features/sessions/filter/TagFilterBar.tsx:149-159`

### 1.16 `LOW` Session row → hover actions → Rename/Archive icon glyphs — icon
- **Design:** Artboard literally uses `paperclip` for the "Rename" hover action and `xmark` (X) for "Archive" (02-chrome.jsx:458-459) — inconsistent with their own titles, but that is the ground-truth glyph choice. — `02-chrome.jsx:456-460`
- **Code:** Production uses semantically-correct `PencilIcon` for Rename and `ArchiveIcon` for Archive instead of the literal (mismatched) artboard glyphs. — `packages/ui/src/features/sessions/sidebar/SessionRow.tsx:149-158`

<details><summary>Coverage notes</summary>

Read 02-chrome.jsx in full (TrafficLights, Sidebar header, SESSIONS_DATA, TagPill, StatusDot, HoverActionBtn, SessionRowDense, Sidebar shell incl. project pills/sessions list/tag row/resize handle/bottom Context-Skills-Agents tabs/footer, FilterPill) and component-map.md §2/§4/§6/§7/§9 in full. Compared against production: layout/SidebarShell.tsx, SidebarHeader.tsx, SidebarFooter.tsx; features/sessions/sidebar/{SessionSidebar,SessionRow,SessionRowMeta,SessionGroupHeader,SessionListVirtuoso,FilterPill,ProjectFilterPillBar,SessionSortMenu,SessionsMoreMenu,SessionContextMenu,ExternalSessionRow,project-color}.tsx; features/sessions/filter/TagFilterBar.tsx; features/sessions/view-model/{session-status,relative-time,group-sessions,attention-counts,count-by-base-status}.ts; features/context-panel/{BottomPanel,PanelResizeHandle}.tsx (the bottom tabbed panel referenced by the artboard's Sidebar body, since SidebarShell composes it directly under the sessions list). Verified every class against packages/ui/src/styles/globals.css (@theme spacing/radius/color tokens) rather than assuming standard Tailwind. Not covered: ArchivedSessionsDialog/ImportSessionsDialog/ExternalSessionRow internals (out of 02-chrome.jsx scope), the ContextInspector/SkillsList/AgentsList row-level content (only the tab-bar chrome wrapping them was in scope), and no live render/screenshot was taken (source-level diff per the project's stated preference).

</details>

<a id="area-2"></a>
## 2. Left Sidebar — bottom panel (Context / Skills / Agents tabs)

### 2.1 `HIGH` Bottom panel -> Context/Skills/Agents tab bar -> track wrapper — missing-element *(adjusted by verifier)*
- **Design:** Full-width segmented-control TRACK: `padding:2px, borderRadius:7px, background: var(--mf-chip-bg)/T.chipBg, display:flex, gap:2`. Segments are children of this track, each `flex:1`. — `prompt-sidebar-panel-headers.md:14-16; 02-chrome.jsx:973-1007 (implementation ground truth: `<div style={{display:'flex',width:'100%',padding:2,gap:2,borderRadius:7,background:T.chipBg}}>`)`
- **Code:** Outer row is `<div className="flex shrink-0 items-center gap-0.5 px-2 py-1">` — no `bg-mf-chip`, no `rounded-[7px]`, wrong padding (4px via `px-2`/`py-1` vs spec's 2px), buttons are NOT `flex-1` so segments don't fill/equally divide the row. — `packages/ui/src/features/context-panel/BottomPanel.tsx:31`
- **Verifier correction:** The missing segmented-control track (no bg-mf-chip fill, no rounded-[7px], no flex-1 segments) is real and high-severity, but the padding detail is wrong: in this app's compressed scale px-2=4px horizontal and py-1=2px vertical — so the vertical padding actually matches the design track's 2px; only the horizontal differs (4px vs the design's wrapper 8px + track 2px sides). BottomPanel.tsx:31 vs 02-chrome.jsx:968-1007 otherwise as stated.

### 2.2 `HIGH` Bottom panel -> tab bar -> phantom tokens `text-mf-text-2` / `bg-mf-hover` — color
- **Design:** Inactive segment text uses `--muted-foreground` (T.text2); hover/inactive surfaces use the shadcn hover surface `--accent` (T.rowHover). — `prompt-sidebar-panel-headers.md:20-21; mainframe-theme.css:72 (`--accent` = T.rowHover), component-map.md token contract`
- **Code:** `className="...font-medium text-mf-text-2 hover:bg-mf-hover"` and icon `className={active ? 'text-primary' : 'text-mf-text-2'}`. Neither `--mf-text-2` nor `--mf-hover` is defined anywhere in `globals.css` (`@theme` only defines `--mf-text-3`/`--mf-text-4` and no `--mf-hover` at all — the real hover surface token is `--accent`). Tailwind silently drops these classes, so inactive tab text/icon render unstyled (inherits) and hover never shows a background. — `packages/ui/src/features/context-panel/BottomPanel.tsx:44,47,49`

### 2.3 `HIGH` Context tab -> Global/Project/Session section headers -> phantom tokens — color
- **Design:** Section icon uses `T.text2` (muted-foreground); count chip background uses `T.chipBg` (`--mf-chip`). — `04-engine.jsx:330,338 (`Icon name={icon} size={11} color={T.text2}`, count chip `background: T.chipBg`)`
- **Code:** `<Icon ... className="shrink-0 text-mf-text-2" />` and count chip `className="shrink-0 rounded-md bg-mf-hover px-1.5 ..."` — both `text-mf-text-2` and `bg-mf-hover` are phantom (undefined in globals.css); should be `text-muted-foreground` and `bg-mf-chip` respectively. Same bug repeats in `ContextFileItem.tsx:26,30` and `ScopedListRow.tsx:21,30`. — `packages/ui/src/features/context-panel/ContextSection.tsx:29,31`

### 2.4 `HIGH` Context tab -> Tasks section -> progress bar position — layout
- **Design:** Progress bar (4px track, green fill) + `done/total` count render INLINE in the section HEADER row itself, passed as the `trailing` slot of `ContextSection` (replacing the count chip) — i.e. same row as chevron/icon/'Tasks' label, flex:1 bar taking the remaining header width. — `04-engine.jsx:248-264 (`<ContextSection icon="circle.dotted" title="Tasks" trailing={<progress bar + count>}>`), ContextSection trailing slot 04-engine.jsx:335 (`{trailing ?? <count chip>}`)`
- **Code:** `TasksSection` puts the progress bar as a SEPARATE row BELOW the header, inside the section body: `<ContextSection icon={CircleDashed} title="Tasks" count={total} defaultOpen><div className="mb-2 flex items-center gap-2 px-[14px]">...progress bar...</div>...`. `ContextSection` has no `trailing` prop at all, so the header always shows the generic count chip instead of the inline progress bar — structurally different from the artboard (bar is indented body content, not part of the header row). — `packages/ui/src/features/context-panel/TasksSection.tsx:12-26; packages/ui/src/features/context-panel/ContextSection.tsx:5-11 (no trailing prop)`

### 2.5 `MEDIUM` Bottom panel -> tab bar -> segment radius/padding — radius
- **Design:** Each segment `padding:'4px 6px', borderRadius:5px`. — `02-chrome.jsx:989-990`
- **Code:** `rounded-md px-[9px] py-1` — radius resolves to 8px (`--radius-md`), not 5px; padding is 9px/2px, not 6px/4px. — `packages/ui/src/features/context-panel/BottomPanel.tsx:41`

### 2.6 `MEDIUM` Bottom panel -> tab bar -> inline count — color
- **Design:** Count is a plain inline number (no pill/background), `fontSize:9.5, fontWeight:600`, color `ACCENT` when active / `T.text4` (faintest tone) when inactive. — `02-chrome.jsx:999-1002; prompt-sidebar-panel-headers.md:22-23`
- **Code:** Count rendered as a pill chip `rounded-full bg-mf-hover px-1.5 text-micro text-mf-text-3` — always `text-mf-text-3` regardless of active state (never accent-tinted when active), wrapped in a background chip the design doesn't have, and `bg-mf-hover`/`text-mf-text-3`... `bg-mf-hover` is a phantom token (see separate finding). — `packages/ui/src/features/context-panel/BottomPanel.tsx:49`

### 2.7 `MEDIUM` Context tab -> file rows (Global/Project/Session) -> indentation — spacing
- **Design:** File row padding `'3px 14px 3px 24px'` — 24px LEFT indent (nests the row visually under the section header's icon/chevron), 14px right, 3px top/bottom. — `04-engine.jsx:354-360 (`ContextFileItem` div `padding: '3px 14px 3px 24px'`)`
- **Code:** `className="flex w-full min-w-0 items-center gap-2 rounded-md px-[12px] py-1 ..."` — uniform 12px horizontal padding (no extra left indent) and `py-1`=2px vertical (not 3px). Rows sit flush with the section header's left edge instead of nested/indented under it. — `packages/ui/src/features/context-panel/ContextFileItem.tsx:26`

### 2.8 `MEDIUM` Context tab -> 'Global' section icon — icon
- **Design:** Icon name `"wifi"` (radio-waves glyph) for the Global section. — `04-engine.jsx:289 (`<ContextSection icon="wifi" title="Global" count={2} defaultOpen>`)`
- **Code:** `<ContextSection icon={Globe} title="Global" ...>` — uses lucide `Globe` (a sphere/world icon), not a wifi/radio-waves glyph. Plausible-but-wrong glyph swap. — `packages/ui/src/features/context-panel/ContextInspector.tsx:29`

### 2.9 `MEDIUM` Context tab -> Session group -> file badge (@/auto/plan/skill) coloring — color
- **Design:** Badge is type-colored: `'@':ACCENT, auto:T.text3, plan:T.amber, skill:'#bf5af2'` — background `badgeColor+'20'` (20% tint), text `badgeColor`, `fontFamily:MONO`, `fontWeight:700`, uppercase, `borderRadius:4`. — `04-engine.jsx:351-353,368-375`
- **Code:** Badge is rendered with one uniform style regardless of type: `className="shrink-0 rounded-full bg-mf-hover px-1.5 text-micro text-mf-text-3"` — no per-badge-type color/tint, not monospace, not uppercase, `rounded-full` instead of ~4px radius. The `@`/`auto`/`plan`/`skill` semantic distinction the design uses color to convey is entirely lost. — `packages/ui/src/features/context-panel/ContextFileItem.tsx:30`

### 2.10 `MEDIUM` Skills/Agents tab -> scope chip — color
- **Design:** Scope chip: `padding:'1px 5px', borderRadius:8, background: T.chipBg` (`--mf-chip`). — `02-chrome.jsx:1035-1039,1062-1066`
- **Code:** `className="rounded-lg bg-mf-hover px-[5px] ..."` — `rounded-lg` resolves to 11px (not the design's 8px), `bg-mf-hover` is a phantom token (undefined; should be `bg-mf-chip`), and there is no vertical padding utility (design wants 1px top/bottom). — `packages/ui/src/features/context-panel/ScopedListRow.tsx:30`

### 2.11 `LOW` Context tab -> file row icon size — icon
- **Design:** File row leading icon `name="doc"` at `size={10}`, color `T.text3`. — `04-engine.jsx:361 (`<Icon name="doc" size={10} color={T.text3}/>`)`
- **Code:** `<FileText size={14} className="shrink-0 text-mf-text-3" />` — 14px vs design's 10px (40% larger); glyph choice (FileText for 'doc') is a reasonable lucide equivalent. — `packages/ui/src/features/context-panel/ContextFileItem.tsx:28`

### 2.12 `LOW` Skills/Agents tab -> row vertical padding — spacing
- **Design:** Row `padding: '4px 12px'` (4px top/bottom). — `02-chrome.jsx:1018-1020,1047-1049 (`padding: '4px 12px'`)`
- **Code:** `className="grid w-full grid-cols-[14px_1fr_auto] items-center gap-[7px] px-[12px] py-1 ..."` — `py-1` = 2px vertical, not 4px. — `packages/ui/src/features/context-panel/ScopedListRow.tsx:21`

### 2.13 `LOW` Context tab -> Session group -> Attachments subsection — extra-element
- **Design:** No Attachments grid/subsection exists anywhere in the Context tab of the prototype (`ContextInspector`/`ContextSection`/`ContextFileItem` in 04-engine.jsx enumerate only Global/Project/Session file lists; the design's Session group seed data has no attachment entries and no attachments UI). — `04-engine.jsx:236-316 (full ContextInspector — no attachments code path)`
- **Code:** Production adds an `Attachments` sub-header + `SessionAttachmentsGrid` (4-col thumbnail grid with lightbox) inside the Session `ContextSection` whenever `context.attachments.length > 0`. This is new UI with no artboard to verify visual parity against (spacing/radius/hover states are unauditable — there is no ground truth). — `packages/ui/src/features/context-panel/ContextInspector.tsx:45-50; packages/ui/src/features/context-panel/SessionAttachmentsGrid.tsx:41-84`

### 2.14 `LOW` Bottom panel -> tab bar -> segment gap — spacing
- **Design:** Tab row itself has no defined outer padding in the spec beyond the track's own `padding:2px`; the track sits inside a `padding:'6px 8px 5px'` header wrapper. — `02-chrome.jsx:973-980 (outer wrapper `padding: '6px 8px 5px'`, track `padding:2, gap:2`)`
- **Code:** `className="flex shrink-0 items-center gap-0.5 px-2 py-1"` — `px-2`=4px / `py-1`=2px, vs design's asymmetric `6px 8px 5px` (6 top, 8 sides, 5 bottom); since there's no separate track element, this outer padding is being used to fake the track spacing, and it doesn't match either the wrapper's or the track's design values. — `packages/ui/src/features/context-panel/BottomPanel.tsx:31`

<details><summary>Coverage notes</summary>

Read the full authoritative spec (prompt-sidebar-panel-headers.md §1) and the actual segmented-control reference implementation it points to (02-chrome.jsx Sidebar bottom-tab block, lines 966-1070), plus the ContextInspector/ContextSection/ContextFileItem ground truth in 04-engine.jsx (lines 236-378) and the Skills/Agents row templates in 02-chrome.jsx (lines 1010-1068). Cross-checked every referenced token (--mf-chip, --mf-tab-active, --mf-text-3/4, --accent, --muted-foreground, --radius-*, --spacing-*, --text-*) against the real packages/ui/src/styles/globals.css @theme block to confirm which mf-* tokens exist vs are phantom. Compared production files: BottomPanel.tsx, ContextInspector.tsx, ContextSection.tsx, ContextFileItem.tsx, TasksSection.tsx, SkillsList.tsx, AgentsList.tsx, ScopedListRow.tsx, SessionAttachmentsGrid.tsx, PanelResizeHandle.tsx, and derive-session-items.ts line-by-line against the design, converting every Tailwind spacing/radius class through the compressed-scale table before judging (not the standard 4px/8px assumptions). Confirmed the two user-reported bugs precisely (Tasks progress bar is a separate body row vs design's inline header trailing-slot; file rows lack the design's 24px left indent) and confirmed the reported phantom bg-mf-hover/text-mf-text-2 bug is real and systemic across 4 files. Did not run the app / take live screenshots (source-level review only, per the prototype README's stated preference); did not audit the 'Tags' filter hairline-removal item (that lives in ProjectFilterPillBar.tsx / the Sessions-list area, outside this area's file scope) or PanelResizeHandle beyond a structural read (its 5px/1px hairline handle matches 02-chrome.jsx's resize handle closely and had no design deltas worth flagging).

</details>

<a id="area-3"></a>
## 3. Add Project — Directory Picker modal

### 3.1 `HIGH` Directory Picker -> Header -> layout & padding — spacing
- **Design:** Header row: `padding: '13px 16px'`, `borderBottom: 0.5px solid T.hairline`, flex row with title left / close button right, `justifyContent: space-between` (16-dirpicker.jsx:149). — `16-dirpicker.jsx:149`
- **Code:** `DialogHeader className="px-4 pt-4 pb-2 shrink-0"` = 8px left/right, 8px top, 4px bottom (globals.css spacing-4=8px, spacing-2=4px) — no bottom border at all, and no `justify-between`/close-button-in-row (close button is absolutely positioned by the base DialogContent, not laid out inline with the title). — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:268-272`
- **Note:** Padding is 8/8/4 vs design's 13/16 (all four sides), and the header hairline separator from the tree below is entirely missing — the header visually bleeds into the home-crumb row instead of being a separated band.

### 3.2 `HIGH` Directory Picker -> Header -> title text — text
- **Design:** Directory-mode default title: `'Select Project Directory'`; file-mode: `'Select File'` (16-dirpicker.jsx:48). — `16-dirpicker.jsx:48`
- **Code:** `pending?.title ?? (pending?.mode === 'file' ? 'Select a file' : 'Select a directory')` — default directory title is `'Select a directory'`, not `'Select Project Directory'`; file title is `'Select a file'`, not `'Select File'`. Also `useAddProject` passes an explicit override title `'Add project'` (features/sessions/use-add-project.ts:21), which never matches the artboard's `'Select Project Directory'` for the Add-Project entry point at all. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:270 ; packages/ui/src/features/sessions/use-add-project.ts:21`

### 3.3 `HIGH` Directory Picker -> Home-crumb row — missing-element
- **Design:** A dedicated home-crumb row directly under the header: `padding: '7px 14px'`, mono font, `fontSize: 11`, `color: T.text3`, icon `folder.fill` size 12 color `T.text4`, text = the fixed home path `DP_HOME` (`/Users/glen`) — always the OS home, regardless of current selection (16-dirpicker.jsx:161-163). — `16-dirpicker.jsx:161-163`
- **Code:** The crumb row exists but its content is wired to `selectedPath ?? '~'` — i.e. it shows the CURRENTLY SELECTED node's path once anything is picked, not the fixed home directory. This is a different semantic: the artboard's crumb is a static "you are browsing under this home" label; the code's crumb becomes a live path readout of the selection, which duplicates the footer's selected-path label instead of showing home. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:274-279`
- **Note:** Padding itself (px-3.5 py-[7px] = 14px/7px) matches the design's 7px 14px. The behavioral drift (home label vs live-selection label) is the real issue.

### 3.4 `HIGH` Directory Picker -> Tree rows -> 'Empty' state — state
- **Design:** When an expanded node has zero children (and isn't loading), render `'Empty'` inline at `padding: '4px 10px'`, `paddingLeft: (depth+1)*16+30`, `fontSize: 11`, `color: T.text4` (16-dirpicker.jsx:125-127). — `16-dirpicker.jsx:125-127`
- **Code:** No equivalent per-node "Empty" row exists anywhere in FlatTreeView / PickerRow. When `handleToggle` loads zero children, `childrenPaths` becomes `[]`, `collect()` simply recurses over an empty array and renders nothing — an expanded empty folder shows a chevron pointing down with no content beneath it and no indication it's empty. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:105-139`

### 3.5 `HIGH` Directory Picker -> Tree rows -> 'Loading…' (per-node lazy expand) — state
- **Design:** When a node is expanding and children haven't arrived yet, render `'Loading…'` inline beneath that node at the same indent formula, `fontSize: 11`, `color: T.text4`, with a `tw-pulse` animation class (16-dirpicker.jsx:130-132). — `16-dirpicker.jsx:130-132`
- **Code:** No per-node loading indicator. `handleToggle` optimistically flips `expanded: true` immediately and fires the browse call, but nothing renders between the optimistic expand and the `.then()` callback populating `childrenPaths` — the row just shows an expanded chevron with nothing under it until the fetch resolves. No pulse/loading state exists at the node level (only the top-level root `directory-picker-loading` state exists). — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:199-234`

### 3.6 `HIGH` Directory Picker -> Footer -> layout & padding — spacing *(adjusted by verifier)*
- **Design:** `padding: '11px 16px'`, `borderTop: 0.5px solid T.hairline`, `justifyContent: space-between` — selected-path label on the LEFT, Cancel+Select buttons grouped on the RIGHT (16-dirpicker.jsx:171-181). — `16-dirpicker.jsx:171-181`
- **Code:** `DialogFooter className="px-4 py-3 shrink-0 border-t border-border flex items-center justify-end gap-2"` — padding 8px/12px (spacing-4=8px, py-3=6px; both under design's 16px/11px), and critically `justify-end` with NO selected-path label rendered anywhere in the footer at all — only the two buttons. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:304`
- **Note:** The mono selected-path readout (T.text3, 11px, max-width 270px, truncated) specified for the footer is completely absent from the built footer — this is a missing element, not just a spacing delta. Combined with the home-crumb row showing the selection instead of home (see above), the modal now shows the selected path in the WRONG slot (top) instead of the RIGHT slot (bottom-left, next to the action buttons).
- **Verifier correction:** Missing selected-path label + justify-end confirmed (footer at DirectoryPickerModal.tsx:304 contains only the two buttons), but the padding statement is internally wrong: 'padding 8px/12px' should be 8px horizontal / 6px vertical (px-4 = --spacing-4 = 8px, py-3 = --spacing-3 = 6px) vs design's 16px/11px. The parenthetical had it right; the headline value did not.

### 3.7 `HIGH` Directory Picker -> Footer -> Select/Choose button label — text
- **Design:** Confirm button label is always `'Select'` regardless of mode (16-dirpicker.jsx:179). — `16-dirpicker.jsx:179`
- **Code:** Label is `pending?.mode === 'file' ? 'Select' : 'Choose'` — directory mode (the Add-Project path) renders `'Choose'`, which never appears in the artboard at all. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:320`

### 3.8 `MEDIUM` Directory Picker -> Modal shell -> width — layout
- **Design:** 480px fixed width (`width: 480, maxWidth: '92vw'`) (16-dirpicker.jsx:145). — `16-dirpicker.jsx:145`
- **Code:** `className="max-w-lg ..."` on DialogContent — Tailwind's un-overridden `max-w-lg` = 32rem = 512px, and the base DialogContent also applies `w-full` with no explicit width, so on any viewport ≥512px the modal renders 512px wide, not 480px. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:267`

### 3.9 `MEDIUM` Directory Picker -> Header -> title typography — typography
- **Design:** `fontSize: 14, fontWeight: 700, letterSpacing: -0.2` (16-dirpicker.jsx:150). — `16-dirpicker.jsx:150`
- **Code:** `DialogTitle className="text-body"` on top of the base `text-heading font-semibold leading-none` — `text-body` (13px) overrides `text-heading`'s size utility, but `font-semibold` (600, not 700) and no explicit `-0.2` tracking survive from the base. Net result: 13px/600, not 14px/700. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:269 ; packages/ui/src/components/ui/dialog.tsx:79`

### 3.10 `MEDIUM` Directory Picker -> Header -> close button — spacing *(adjusted by verifier)*
- **Design:** `width: 26, height: 26, borderRadius: 7`, inline in the header's flex row, icon `xmark` size 14 color T.text2 (16-dirpicker.jsx:151-158). — `16-dirpicker.jsx:151-158`
- **Code:** Close button comes from the base DialogContent: `size-7` (28px, not 26), `rounded-md` (8px = --radius-md, not 7px), `absolute right-3 top-3` (not inline / not vertically centered against a 13px/700 title the way the artboard lays it out), icon `size-4` (16px, not 14). — `packages/ui/src/components/ui/dialog.tsx:51-64`
- **Verifier correction:** Drift is real but the pixel values are wrong — the finder used the standard scale, but size-* consumes the compressed spacing scale (globals.css: --spacing-7:20px, --spacing-4:8px). The close button is size-7 = 20px (not 28px) vs design 26px, and the XIcon is size-4 = 8px (not 16px) vs design 14px — i.e. the button and icon are SMALLER than design, not larger. rounded-md=8px vs 7px and the absolute right-3 top-3 (6px offsets, not inline in the header row) claims stand.

### 3.11 `MEDIUM` Directory Picker -> Tree rows -> row padding & indent — spacing
- **Design:** `padding: '5px 10px'`, `paddingLeft: depth * 16 + 10` (16-dirpicker.jsx:107-109). Row gap between chevron/icon/label = 6px. — `16-dirpicker.jsx:107-109`
- **Code:** `className="... px-2 py-1 ..."` = 4px/2px (spacing-2=4px, spacing-1=2px) with an inline `style={{ paddingLeft: 8 + indent }}` where `indent = depth*16`, i.e. base left padding 8px vs design's 10px, and vertical padding 2px vs design's 5px (row is noticeably shorter/denser than the artboard). Row gap uses `gap-1.5` = 6px, which does match design's `gap:6`. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:72-73`
- **Note:** Compressed-scale-corrected: px-2=4px (not 8), py-1=2px (not 4). Design wants ~5px/10px; code renders ~2px/8px(+depth). Suggested fix: `py-[5px] px-[10px]` with `paddingLeft: 10 + indent`.

### 3.12 `MEDIUM` Directory Picker -> Tree rows -> folder icon accent-on-state — color
- **Design:** Folder icon is `folder.fill` (solid) in `ACCENT` color when `isSelected || node.expanded`; otherwise outline `folder` in the same `ACCENT` color (icon SHAPE toggles selected/expanded, color is always accent for directories) (16-dirpicker.jsx:119). — `16-dirpicker.jsx:119`
- **Code:** `<FolderIcon className="size-3.5 shrink-0 text-primary" />` unconditionally — always the same lucide glyph regardless of `expanded`/`isSelected`, no solid/outline swap. Color (`text-primary` = ACCENT) does match design. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:84-88`
- **Note:** Also size drift: code renders 14px (size-3.5) vs design's 14px — actually matches on size (14). Only the state-driven glyph swap is missing.

### 3.13 `MEDIUM` Directory Picker -> Tree rows -> label typography — typography *(adjusted by verifier)*
- **Design:** `fontSize: 13, fontWeight: isSelected ? 600 : 500, letterSpacing: -0.1` (16-dirpicker.jsx:112). — `16-dirpicker.jsx:112`
- **Code:** No explicit font-size class on the row button (relies on inherited body text, i.e. whatever the Dialog/base sets — not `text-body`=13px explicitly declared here), and no font-weight toggle between selected/unselected — text is always default weight. No letter-spacing utility applied either. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:64-91`
- **Note:** Class list on PickerRow's button is `text-body outline-none hover:bg-accent ...` — text-body IS present (13px, correct), but the 600-weight-when-selected rule from the design is absent; selected rows read at the same weight as unselected.
- **Verifier correction:** The 'code' field's claim 'No explicit font-size class on the row button' is false — DirectoryPickerModal.tsx:72 includes `text-body` (13px, matching design's fontSize:13); the finding's own note contradicts the body. The real drift stands: no font-weight rule (always default 400 vs design's 500 unselected / 600 selected, 16-dirpicker.jsx:112) and no -0.1 letter-spacing. (Additionally unflagged: unselected rows inherit foreground/T.text rather than design's T.text2.)

### 3.14 `MEDIUM` Directory Picker -> Tree rows -> selected background token — color
- **Design:** `background: isSelected ? T.selBg : 'transparent'` — hover uses a distinct `T.rowHover` (16-dirpicker.jsx:110, 114). — `16-dirpicker.jsx:110-115`
- **Code:** `isSelected ? 'bg-mf-selection text-foreground' : ''` combined with `hover:bg-accent hover:text-accent-foreground` on the SAME element — meaning when a row is selected AND hovered, Tailwind's class-order/hover pseudo-class will still apply `hover:bg-accent` on top since both are plain utility classes (no `group` gating), overriding the selection tint on hover. The artboard explicitly guards this (`onMouseEnter: if (!isSelected) ...`) so a selected row's background never changes on hover. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:72`

### 3.15 `MEDIUM` Directory Picker -> Tree container -> root 'Loading…' copy/style — typography
- **Design:** Root loading text: `'Loading…'`, `padding: '32px 16px'`, `fontSize: 13`, `color: T.text3`, no bold/centering beyond text-align center (16-dirpicker.jsx:167). — `16-dirpicker.jsx:167`
- **Code:** `'Loading…'` text matches, but styled `px-4 py-6 text-caption text-muted-foreground` — `py-6`=16px (not 32px) and `text-caption`=11px (not 13px), and color is `text-muted-foreground`(T.text2) not T.text3. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:283-290`

### 3.16 `MEDIUM` Directory Picker -> Footer -> Cancel button — spacing
- **Design:** `padding: '7px 13px'`, `borderRadius: 8`, `background: T.chipBg`, `color: T.text2`, `fontSize: 12`, `fontWeight: 500` (16-dirpicker.jsx:174). — `16-dirpicker.jsx:174`
- **Code:** `className="rounded-md bg-mf-chip px-3 py-1.5 text-body text-muted-foreground hover:bg-accent hover:text-accent-foreground"` — `px-3`=6px / `py-1.5`=6px (design wants 13px/7px), `rounded-md`=8px (matches), `bg-mf-chip` matches T.chipBg, but `text-body`=13px vs design's 12px, and no explicit font-weight class (default 400, design wants 500). — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:305-312`

### 3.17 `MEDIUM` Directory Picker -> Footer -> Select button styling — spacing *(adjusted by verifier)*
- **Design:** `padding: '7px 15px'`, `borderRadius: 8`, `fontSize: 12, fontWeight: 600`, disabled -> `opacity: 0.4` (16-dirpicker.jsx:175-179). — `16-dirpicker.jsx:175-179`
- **Code:** `px-3 py-1.5` = 6px/6px (design wants 15px/7px), `rounded-md` matches, `text-body`=13px (design wants 12px), no font-weight class (default 400 vs design's 600), disabled state uses `disabled:opacity-50` (0.5, not the design's 0.4). — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:313-321`
- **Note:** opacity-50 vs opacity-40 is a real, if subtle, drift — Tailwind has no 40 step by default so this needs an arbitrary `disabled:opacity-[0.4]`.
- **Verifier correction:** All styling deltas verified (px-3/py-1.5 = 6px/6px vs 15px/7px; text-body 13px vs 12px; no weight class = 400 vs 600; disabled:opacity-50 vs design 0.4), but the note's claim 'Tailwind has no 40 step by default so this needs an arbitrary disabled:opacity-[0.4]' is wrong — `disabled:opacity-40` is a valid built-in utility (40%).

### 3.18 `LOW` Directory Picker -> Add project pill (sidebar trigger) — state *(adjusted by verifier)*
- **Design:** Static ghosted pill: `border: 1px dashed T.borderH`, `color: T.text3`, hover -> `background: T.rowHover; color: T.text2` (02-chrome.jsx:840-850). No context-menu / remove affordance on this control.
- **Code:** ProjectFilterPillBar.tsx implements the pill correctly (dashed border-border, text-mf-text-3, hover:border-primary hover:text-foreground) — this part matches. Listed here only as the entry point; no delta.
- **Note:** Confirms the trigger itself is in good shape; all deltas below are inside the modal it opens.
- **Verifier correction:** The pill does NOT fully match. Structure is close (h-[22px]=22, rounded-[11px], dashed border, text-caption=11px, text-mf-text-3), but ProjectFilterPillBar.tsx:115 hovers to `hover:border-primary hover:text-foreground` while the design (02-chrome.jsx:847-848) hovers to background T.rowHover + color T.text2 with the border unchanged. Also: font-medium (500) vs design fontWeight 600; icon is bare lucide `Plus` vs design `folder.plus`; border token is border-border (rgba(0,0,0,0.08)) vs design T.borderH (rgba(0,0,0,0.14)). 'No delta' is wrong — the trigger has real hover/weight/icon drift.

### 3.19 `LOW` Directory Picker -> Modal shell -> radius — radius
- **Design:** `borderRadius: 13` (16-dirpicker.jsx:146) — i.e. `--radius-xl`.
- **Code:** Base `DialogContent` applies `rounded-xl` (packages/ui/src/components/ui/dialog.tsx:38) which resolves to `--radius-xl` = 13px per globals.css:746. This actually matches. — `packages/ui/src/components/ui/dialog.tsx:38`
- **Note:** No delta — confirmed correct, included to show it was checked.

### 3.20 `LOW` Directory Picker -> Modal shell -> scrim — color
- **Design:** `background: 'rgba(22,19,15,0.40)'` (16-dirpicker.jsx:142).
- **Code:** DialogOverlay uses `bg-mf-scrim` which resolves to `--mf-scrim: rgba(22, 19, 15, 0.40)` in light mode (globals.css:95). Matches design exactly. — `packages/ui/src/components/ui/dialog.tsx:15`
- **Note:** No delta — confirmed correct.

### 3.21 `LOW` Directory Picker -> Modal shell -> extra chrome not in design — extra-element
- **Design:** Modal is a plain overlay card — no border ring, entrance is implicit/instant (no scale/slide keyframe specified) (16-dirpicker.jsx:144-147).
- **Code:** Base DialogContent adds `border border-border`, a zoom-in/slide-in-from-top-48% entrance animation, and backdrop-blur-sm on the overlay — none of which exist in the artboard for this or any other modal. — `packages/ui/src/components/ui/dialog.tsx:15,38,40-45`
- **Note:** This is baked into the shared shadcn Dialog primitive (affects all dialogs, not unique to this picker) so flagging low/systemic rather than picker-specific; mentioning because it does add visual chrome absent from the artboard.

### 3.22 `LOW` Directory Picker -> Home-crumb row -> icon color — color *(adjusted by verifier)*
- **Design:** `folder.fill` icon at `color: T.text4` (16-dirpicker.jsx:162) — the dimmest gray, since it's a static/inert label icon.
- **Code:** `FolderIcon className="size-3 shrink-0 text-mf-text-4"` — actually matches T.text4. No delta on color; size is `size-3`=12px matching design's `size:12`. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:275`
- **Note:** No delta — confirmed correct in isolation from the semantic issue above.
- **Verifier correction:** Color does match (text-mf-text-4 = T.text4), but the size claim is wrong: size-3 = --spacing-3 = 6px under the compressed scale (globals.css:776), not 12px. The crumb folder icon renders at HALF the design's size:12 (16-dirpicker.jsx:162) — this is a real drift the finding declared a match; needs size-5 (=12px) or size-[12px].

### 3.23 `LOW` Directory Picker -> Home-crumb row -> icon variant — icon
- **Design:** Icon name is `folder.fill` — a SOLID/filled folder glyph, distinct from the outline `folder` used elsewhere for unselected tree rows (16-dirpicker.jsx:162, 119). — `16-dirpicker.jsx:162`
- **Code:** Uses lucide `FolderIcon` — lucide's default `Folder` is an OUTLINE glyph (there is no separate filled variant used here); the tree rows use the same `FolderIcon` for both directory states (see next finding), so the code has no solid/outline distinction at all in this area. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:275`

### 3.24 `LOW` Directory Picker -> Tree rows -> chevron slot — spacing
- **Design:** Fixed slot: `width: 14, display:'inline-flex', justifyContent:'center'` holding a 12px chevron, so file rows (no chevron) still reserve the same 14px gutter so folder/file names align vertically (16-dirpicker.jsx:116-118). — `16-dirpicker.jsx:116-118`
- **Code:** Directory rows render `ChevronDownIcon`/`ChevronRightIcon` at `size-3.5` (14px, not the design's 12px chevron), and file rows render a bare `<span className="size-3.5 shrink-0" />` spacer — same width so alignment is preserved, but the chevron itself is oversized relative to spec (12px expected). — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:75-83`

### 3.25 `LOW` Directory Picker -> Tree rows -> file icon — icon
- **Design:** File rows use icon name `doc` (outline document) at `size:14`, `color: T.text3` (16-dirpicker.jsx:119). — `16-dirpicker.jsx:119`
- **Code:** `<FileIcon className="size-3.5 shrink-0 text-muted-foreground" />` — lucide `FileIcon` is a reasonable doc-outline equivalent, 14px matches, `text-muted-foreground` resolves to T.text2 not T.text3 in this theme's semantic mapping (`--muted-foreground` = T.text2 per mainframe-theme.css comment, `--mf-text-3` is the distinct dimmer token). — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:86-87`
- **Note:** Icon choice is fine; color token is one step too dark (text2 vs text3).

### 3.26 `LOW` Directory Picker -> Tree rows -> load-error state — extra-element
- **Design:** No error-row state is defined for child-browse failures in the artboard (mock tree never errors).
- **Code:** Code adds a `loadError` per-node flag rendering `'Failed to load'` in `text-destructive` — a reasonable real-world addition (daemon calls can fail) not represented in the design, since the prototype has no disk I/O to fail. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:126-134`
- **Note:** Not a drift against design intent — flagging only because the instruction says to note invented UI; this addition is justified by real backend behavior and should stay.

### 3.27 `LOW` Directory Picker -> Tree container -> padding & min-height — spacing
- **Design:** `padding: '6px 0'`, `minHeight: 300` reserved so the tree area doesn't jump size while loading (16-dirpicker.jsx:165). — `16-dirpicker.jsx:165`
- **Code:** `FlatTreeView` wraps rows in `className="py-1"` (2px vertical, spacing-1=2px) with no horizontal 0 statement needed (fine) but no `min-h-[300px]` — the scroll container is `flex-1 overflow-y-auto min-h-0` with no minimum reserved height, so short trees / loading states will visibly resize the modal. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:122 ; 281`

### 3.28 `LOW` Directory Picker -> Tree container -> empty-folder-at-root state — missing-element
- **Design:** The artboard's only empty-state UI is the per-node 'Empty' inline row (16-dirpicker.jsx:125-127); it does not define a distinct root-level "this folder is empty" full-pane message (the mock tree always has root entries). — `16-dirpicker.jsx:125-127`
- **Code:** Code adds a root-level empty state: `'This folder is empty.'`, `text-caption text-muted-foreground`, centered (DirectoryPickerModal.tsx:291-298). Reasonable and not contradicted by the design, but worth flagging that its copy/style ('This folder is empty.') is invented rather than reusing the design's terse 'Empty' token used elsewhere — inconsistent voice within the same component (one place would say 'Empty', this says a full sentence). — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:291-298`

### 3.29 `LOW` Directory Picker -> Footer -> button order/gap — layout
- **Design:** Buttons grouped with `gap: 8` between Cancel and Select (16-dirpicker.jsx:173). — `16-dirpicker.jsx:173`
- **Code:** `gap-2` = 4px between the two footer buttons. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:304`

### 3.30 `LOW` Directory Picker -> Escape-to-cancel — behavior
- **Design:** Explicit `keydown` listener on Escape calls `onCancel()` while modal is open (16-dirpicker.jsx:53-58).
- **Code:** Not implemented explicitly, but Radix Dialog handles Escape-to-close natively via `onOpenChange`, which is wired to `resolve(null)` — behavior parity is achieved through the primitive, not a gap. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:262-265`
- **Note:** No delta — confirmed correct via Radix's built-in handling.

### 3.31 `LOW` Directory Picker -> Click-outside-to-cancel — behavior
- **Design:** Clicking the scrim (outer `onClick={onCancel}`, with `stopPropagation` on the inner card) closes/cancels the picker (16-dirpicker.jsx:140-144).
- **Code:** Radix Dialog's default outside-click closes and triggers `onOpenChange(false)` -> `resolve(null)`. Matches. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:262-265`
- **Note:** No delta.

### 3.32 `LOW` Directory Picker -> data-testid coverage — state
- **Design:** N/A (design has no testids; this is a code-quality check against project convention).
- **Code:** Interactive elements are tagged: `directory-picker` (root), `directory-picker-row-${entry.path}` (loop items keyed off the domain path, not index — correct), `directory-picker-crumb`, `directory-picker-loading`, `directory-picker-empty`, `directory-picker-cancel`, `directory-picker-confirm`, `directory-picker-load-error-${path}`. This satisfies the project's `<surface>-<element>` convention and index-free loop keys. — `packages/ui/src/components/overlays/DirectoryPickerModal.tsx:67,276,285,293,307,315`
- **Note:** No delta — testid hygiene is good and should not be disturbed by the fixes above.

<details><summary>Coverage notes</summary>

Read /tmp/parity-audit/design-current/16-dirpicker.jsx in full (the DirectoryPickerModal artboard) and the "Add project" pill in 02-chrome.jsx (lines 840-850, plus the surrounding project-pill-row context). Read mainframe-theme.css for the scrim/text token contract. Compared against packages/ui/src/components/overlays/DirectoryPickerModal.tsx, features/files/use-directory-picker.ts, features/sessions/use-add-project.ts, components/ui/dialog.tsx (the shadcn base the modal composes), features/sessions/sidebar/ProjectFilterPillBar.tsx (the trigger pill), and packages/ui/src/styles/globals.css for every token/spacing/radius value cited (--spacing-*, --radius-*, --text-*, --mf-scrim, --mf-text-3/4, --mf-selection, --mf-chip). Did not run/screenshot the app; this is a source-level structural+token diff per the calibration rules. FindInPathModal.tsx was opened only to confirm it does not share chrome with this component (it doesn't reuse DirectoryPickerModal internals) — not separately audited as it's out of area.

</details>

<a id="area-4"></a>
## 4. Transcript — assistant turns, markdown, code blocks, thread chrome

### 4.1 `HIGH` Transcript -> Markdown -> Ordered/unordered/task lists — missing-element
- **Design:** Custom list rendering: ordered items get a mono, accent-colored, bold 2-digit index (`01`, `02`…) in a 22px column (08-markdown.jsx:144-145); unordered items get a 5px round dot in T.text3 (08-markdown.jsx:147); task items get a bespoke 15px checkbox with radius 4, 1.5px border, green fill + white checkmark when done (08-markdown.jsx:141-143), with a `line-through` on the label text.
- **Code:** ul/ol/li use plain browser list markers via Tailwind `list-disc`/`list-decimal` + `marker:text-muted-foreground`; there is no `input`/checkbox override in `markdownComponents`, so remark-gfm task-list checkboxes render as raw unstyled native `<input type="checkbox">` (browser default styling breaks the warm-chrome look entirely). — `packages/ui/src/features/chat/parts/markdown-text.tsx:236-248`

### 4.2 `HIGH` Transcript -> Markdown -> Fenced code block -> line numbers — missing-element
- **Design:** Every code block has a 34px, right-aligned, mono 10px, `T.text4` line-number gutter to the left of each code line (`padding-right:12`).
- **Code:** `ShikiCode`/`SyntaxHighlighter` render a bare `<pre><code>` of token lines with no line-number gutter at all. — `packages/ui/src/lib/shiki-tokens.tsx:109-129; packages/ui/src/features/chat/parts/syntax-highlight.tsx:15-22`

### 4.3 `HIGH` Transcript -> Assistant turn -> TurnHeader (avatar + title + model) — missing-element
- **Design:** Each assistant turn is preceded by a `TurnHeader`: an 18px accent-filled 'm' avatar (radius 6), an optional bold 12px turn title (e.g. "Mapping the layout"), and a mono 10px model label (e.g. "Claude Sonnet 4.5") — shown per-turn, inline above the markdown.
- **Code:** AssistantMessage renders no per-turn avatar/title/model header at all — GroupedParts goes straight from reasoning/tool groups into markdown text with no TurnHeader equivalent. Model/adapter identity is instead surfaced once, persistently, in `ChatSessionBar` above the whole thread (a documented architectural consolidation, not a 1:1 port of this file's TurnHeader) — but that means the artboard's per-turn identity marker (with optional per-turn title) has no equivalent anywhere in the transcript. — `packages/ui/src/features/chat/messages/AssistantMessage.tsx:61-125; packages/ui/src/features/chat/thread/ChatSessionBar.tsx:56-128`

### 4.4 `MEDIUM` Transcript -> Markdown -> Inline code chip — color
- **Design:** Inline `` `code` `` uses a dedicated warm-brown foreground `#7a4d2a` on `T.raised` background (`--mf-raised`, e.g. `#f3efe7` light), radius 4, 0.5px `T.border`.
- **Code:** Inline code reuses the fenced-code-block tokens instead: `bg-mf-code-bg text-mf-code-fg` (block-code bg/fg, e.g. `#fbfaf7`/`#1f1f24`) with `rounded-sm` (6px, not 4px) and `border border-border`. — `packages/ui/src/features/chat/parts/markdown-text.tsx:56-63`

### 4.5 `MEDIUM` Transcript -> Markdown -> Fenced code block -> header language label — typography
- **Design:** Language label is `textTransform: 'uppercase'`, mono 10px, `letterSpacing: 0.3`.
- **Code:** Language label uses `lowercase` instead of uppercase, no letter-spacing utility applied. — `packages/ui/src/features/chat/parts/CodeHeader.tsx:37`

### 4.6 `MEDIUM` Transcript -> Markdown -> Fenced code block -> Copy button — missing-element
- **Design:** Copy button shows an icon AND a text label (`Copy` / `Copied` in green when clicked), fontSize 10, fontWeight 600.
- **Code:** Copy button is icon-only (`Copy`/`Check` from lucide) with no visible text label — copied/uncopied state is conveyed only via `aria-label`, not visible text. — `packages/ui/src/features/chat/parts/CodeHeader.tsx:39-52`

### 4.7 `MEDIUM` Transcript -> Markdown -> Blockquote left padding — spacing
- **Design:** `padding: '4px 0 4px 14px'` — 14px left inset from the accent rule to the text.
- **Code:** `ps-3` is the compressed-scale integer utility = 6px (per `--spacing-3: 6px` in globals.css), not a `[14px]` arbitrary value — under half the design's left inset. — `packages/ui/src/features/chat/parts/markdown-text.tsx:226-235`

### 4.8 `MEDIUM` Transcript -> Markdown -> Heading top margins — spacing
- **Design:** All heading levels (h1-h4) share one flat `marginTop: 2`px; visual size differentiation comes only from font-size (size+7/+4/+2/+0.5).
- **Code:** Each heading level gets a distinct, scaled top margin instead of a flat value: h1 `mt-4`=8px, h2 `mt-3`=6px, h3 `mt-2.5`=10px, h4 `mt-2`=4px — a systematic, per-level spacing invention not in the design. — `packages/ui/src/features/chat/parts/markdown-text.tsx:210-221`

### 4.9 `MEDIUM` Transcript -> Reasoning/Thinking block -> collapsed trigger copy — text
- **Design:** Collapsed, resolved ThinkingBlock trigger reads "Thought for {N} seconds" (a measured duration is always available in the prototype's data model).
- **Code:** `ReasoningTrigger` is called with no `duration` prop anywhere in `AssistantMessage`, so it always falls back to the generic label "Reasoning" instead of a measured "Thought for Ns" — acknowledged in-code as a daemon-data gap ("daemon doesn't yet emit a thinking duration"), but still a visible text delta from the artboard for every reasoning block. — `packages/ui/src/features/chat/messages/AssistantMessage.tsx:71-80; packages/ui/src/components/ui/assistant-ui/reasoning.tsx:108-127`

### 4.10 `LOW` Transcript -> Markdown -> Inline code chip radius — radius
- **Design:** `borderRadius: 4` (xs rung).
- **Code:** `rounded-sm` = 8-2 = 6px per globals.css `--radius-sm: calc(var(--radius) - 2px)`, not the 4px `xs` rung. — `packages/ui/src/features/chat/parts/markdown-text.tsx:59`

### 4.11 `LOW` Transcript -> Markdown -> Link underline — color
- **Design:** Link underline is a 33%-opacity accent border-bottom (`${ACCENT}55`), with `textDecoration: 'none'` — a deliberately faint rule, not a solid underline.
- **Code:** Uses Tailwind `underline` (native text-decoration, full-opacity `currentColor` = `text-primary` at 100%) with no `decoration-primary/40`-style toning — the underline reads noticeably stronger/darker than the design intent. — `packages/ui/src/features/chat/parts/markdown-text.tsx:159-176`

### 4.12 `LOW` Transcript -> Markdown -> Body letter-spacing — typography
- **Design:** The whole MD block sets `letterSpacing: -0.1` (px) uniformly across all text.
- **Code:** No letter-spacing utility (e.g. `tracking-tight`) is applied to `.aui-md`/the markdown container or to individual paragraph/heading overrides — text renders at default (0) tracking. — `packages/ui/src/features/chat/parts/markdown-text.tsx:222-224; packages/ui/src/styles/globals.css:839`

### 4.13 `LOW` Transcript -> Assistant turn -> footer (Timestamp + Timing chips) — extra-element
- **Design:** None of the three ground-truth files render a per-turn wall-clock timestamp or a duration/cost chip under the assistant's markdown — only the hover action-bar-style edit/copy affordances are implied by component-map §1 ('Edit / branch / copy actions' via ActionBarPrimitive).
- **Code:** Every assistant turn renders a persistent footer row with `MessageTimestamp` (clock time) and `MessageTiming` (duration + cost tooltip) in addition to the copy/export action bar — chrome invented beyond the reviewed artboards. — `packages/ui/src/features/chat/messages/AssistantMessage.tsx:118-123; packages/ui/src/features/chat/messages/MessageTimestamp.tsx; packages/ui/src/features/chat/messages/MessageTiming.tsx`

### 4.14 `LOW` Transcript -> Tables -> radius/zebra/header — color
- **Design:** n/a — production matches: header `T.content2` bg + bold `text2`; zebra rows via `ri % 2` (first data row plain, alternating rows tinted `T.content2`); wrapper radius 8 + 0.5px border.
- **Code:** `rounded-md border border-border` wrapper (8px, matches), `bg-mf-content2` thead (matches), `even:bg-mf-content2` zebra on `<tr>` (matches — CSS nth-child parity lines up with the design's `ri % 2` rule since tbody rows are 1-indexed by the browser). — `packages/ui/src/features/chat/parts/markdown-text.tsx:72-112`

### 4.15 `LOW` Transcript -> Blockquote left-rule color — color
- **Design:** n/a — production matches: `border-primary/40` resolves via Tailwind v4 color-mix (safe here, unlike the v3 hex-var trap) and is close to the design's `${ACCENT}66` (~40%).
- **Code:** `border-s-[3px] border-primary/40` — correct width (3px) and a comparable opacity tint. — `packages/ui/src/features/chat/parts/markdown-text.tsx:226-235`

<details><summary>Coverage notes</summary>

Read all three ground-truth design files in full (08-markdown.jsx, 09-toolcards.jsx, 10-chatcards.jsx) plus component-map.md §1/§4/§6. Compared against packages/ui/src: markdown-text.tsx, syntax-highlight.tsx, CodeHeader.tsx, shiki-tokens.tsx, AssistantMessage.tsx, MessageActionBar.tsx, MessageTimestamp.tsx, MessageTiming.tsx, AssistantErrorBlock.tsx, ReadMoreBubble.tsx, SystemMessage.tsx, ChatThread.tsx, ChatCardHeader.tsx, ChatSessionBar.tsx, use-rotating-phrase.ts, reasoning.tsx, tool-group.tsx, tool-dispatch.tsx, chrome.tsx (tool-card shared). Verified every class against packages/ui/src/styles/globals.css (@theme spacing/radius/type-scale/mf-* tokens) rather than assuming standard Tailwind. Did not deep-audit the individual per-tool cards (Bash/Edit/Write/Grep/Read/Permission/Plan/AskUserQuestion bodies) or diff.tsx internals — those belong to the ToolCards/Gates review areas per the app CLAUDE.md's tool-card ownership split; I only checked the parts explicitly named in my AREA NOTES (TurnHeader, markdown renderer, code-block chrome, list/task/table styling, transcript gutters). Did not run the live app / take screenshots; comparison is source-vs-source per the prototype README guidance.

</details>

<a id="area-5"></a>
## 5. Transcript — tool cards + tool groups + system markers

### 5.1 `HIGH` Transcript -> ToolGroup -> default open state — state
- **Design:** ToolGroup always initializes `useState(true)` — tool-call groups render expanded on first paint. — `09-toolcards.jsx:173`
- **Code:** MessageToolGroup renders `<ToolGroupRoot>` with no `defaultOpen` prop; ToolGroupRoot defaults `defaultOpen = false`. — `packages/ui/src/features/chat/tools/tool-dispatch.tsx:36-42; packages/ui/src/components/ui/assistant-ui/tool-group.tsx:41`
- **Note:** Every explore tool-group (grep/read/glob/ls investigations) renders collapsed by default in production vs always-expanded in the design — a first-glance behavioral difference, not just styling.

### 5.2 `HIGH` Transcript -> Web/WebFetch tool card — missing-element
- **Design:** `web` tool type has a dedicated card: globe icon (teal #16a394), header verb 'Fetch', body shows a clickable url (accent, mono) + a summary paragraph. — `09-toolcards.jsx:16,156-164 (TOOL_META.web + ToolCard web body)`
- **Code:** absent — TOOL_REGISTRY has no entry for WebFetch/WebSearch; register-cards.ts registers Edit/Write/Read/Glob/Grep/LS/Bash/ExitPlanMode/AskUserQuestion/_Mcp/Schedule*/EnterWorktree/ExitWorktree/Skill/Task/_TaskProgress only, so web calls fall through to the generic shadcn ToolFallback (plain 'Used tool: WebFetch' row, raw JSON args/result, no globe icon, no url/summary layout). — `packages/ui/src/features/chat/tools/register-cards.ts:28-54`
- **Note:** A whole tool family from the design (web fetch/search) has no bespoke visual treatment at all in production.

### 5.3 `HIGH` Transcript -> SearchCard (Grep) body -> structured match rows — missing-element
- **Design:** Grep body renders per-match rows: clickable (opens file), `file` in codeFn color, `:line` in text4, match text in text2, hover highlight, flex row layout with 10px gap. — `09-toolcards.jsx:113-125`
- **Code:** SearchCard's body is a single flat `<pre>` (PlainBody) of the raw result text — no per-row structure, no distinct file/line/text coloring, no click-to-open-file, no hover affordance. — `packages/ui/src/features/chat/tools/cards/SearchCard.tsx:39-51,117-134`
- **Note:** Code comment says 'the daemon never returns a structured GrepMatch array — that dead path has been removed,' explaining why; still a real visual/behavioral gap vs the design's file-jump affordance for grep results.

### 5.4 `MEDIUM` Transcript -> ToolGroup header -> title/count/chevron — typography
- **Design:** Two-tier header: chevron.down/right (11px) leading, then UPPERCASE 11px/700 title (letterSpacing 0.5, color text2), then a separate mono 10px text4 'N calls · time' segment, flex spacer. — `09-toolcards.jsx:172-182`
- **Code:** Single-tier header: optional LoaderIcon (when active) leading, then one text-caption(11px)/font-medium(500)/text-muted-foreground label (no uppercase, no letter-spacing, no separate mono count segment), ChevronDownIcon trailing (rotates instead of swapping glyph). — `packages/ui/src/components/ui/assistant-ui/tool-group.tsx:93-140`
- **Note:** Chevron position (leading→trailing) and the collapse of two typographic tiers into one non-bold, non-uppercase label is a visible hierarchy loss; the derived summary (tool-group-summary.ts) is a reasonable content upgrade but doesn't restore the visual weight.

### 5.5 `MEDIUM` Transcript -> ToolCard header -> horizontal padding + item gap — spacing
- **Design:** Header padding '7px 10px', item gap 9px. — `09-toolcards.jsx:68`
- **Code:** `px-3 py-[7px]` + `gap-2` → horizontal padding 6px (px-3=spacing-3=6px, compressed scale), vertical padding correctly arbitrary 7px, gap 4px (gap-2=spacing-2=4px). — `packages/ui/src/features/chat/tools/shared/card-shell.tsx:131-142`
- **Note:** Vertical padding was done correctly with an arbitrary value; horizontal padding and inter-item gap use integer utilities that resolve ~40% tighter than design (6px vs 10px, 4px vs 9px). Affects every card built on CollapsibleCardShell: Edit/Write/Read/Search.

### 5.6 `MEDIUM` Transcript -> Marker pill (SkillLoaded / Worktree / Schedule / MCP / Compaction) -> pill padding — spacing
- **Design:** Pill padding '4px 11px 4px 9px'. — `10-chatcards.jsx:454`
- **Code:** `px-3 py-1` → horizontal 6px (vs ~9-11px design), vertical 2px (vs 4px design). — `packages/ui/src/features/chat/tools/cards/marker-pill.tsx:62-71`
- **Note:** Pill reads visibly smaller/tighter than the design's rounded chip. Repeats across every marker-family card (SkillLoadedCard, WorktreeStatusPillCard, SchedulePillCard, MCPToolCard) since they all share MarkerPill.

### 5.7 `MEDIUM` Transcript -> TaskCard (subagent) -> avatar tile size / icon size — spacing
- **Design:** TaskGroupCard tile: 24×24, radius 8, bot icon 14px, bg `${ACCENT}18`. — `10-chatcards.jsx:626-628`
- **Code:** `h-6 w-6` = 16px (spacing-6, compressed scale) tile, `rounded-md` = 8px (matches), `Bot size={13}` icon, bg `mf-selection` token. — `packages/ui/src/features/chat/tools/cards/TaskCard.tsx:46-48`
- **Note:** Tile is 8px smaller than design (16px vs 24px) — noticeably smaller avatar chip; icon is 1px smaller (13 vs 14, negligible on its own). Radius and bg-tint intent are fine.

### 5.8 `MEDIUM` Transcript -> per-tool status indicator (StatusDot) — state
- **Design:** ToolStatus renders icon + text label per state: running = spinning arrow.clockwise (11px, amber) + 'Running' (10/600); error = triangle icon (11px, red) + 'Failed' (10/600); done = 5px green dot + 'Done' (10/600). — `09-toolcards.jsx:19-35`
- **Code:** StatusDot renders a colored dot ONLY (w-2 h-2 = 4px) for all three states — no icon, no text label ('Running'/'Failed'/'Done' never rendered) for any family card (Edit/Write/Read/Search/Bash/Plan/AskUserQuestion). — `packages/ui/src/features/chat/tools/shared/chrome.tsx:41-53`
- **Note:** Documented as a deliberate 2026-06-21 decision in the code's own comment ('the Running/Failed/Done word was redundant') — flagging for completeness since it is a clear, systemic departure from the artboard's spec, even though it appears intentional rather than an oversight. Dot size is also 4px vs the design's 5px.

### 5.9 `LOW` Transcript -> ToolGroup header -> running/active loader + shimmer — extra-element
- **Design:** ToolGroup header has no running/active affordance at all — just chevron, title, count. Shimmer text animation is reserved exclusively for ThinkingBlock's live 'Thinking…' state. — `09-toolcards.jsx:172-182 (no loader); 10-chatcards.jsx:94-95 (shimmer only on ThinkingBlock)`
- **Code:** ToolGroupTrigger renders a spinning `LoaderIcon` (size-3.5=14px) plus a `shimmer` text overlay on the label when `active` is true — invented UI not present anywhere in the design's ToolGroup spec. — `packages/ui/src/components/ui/assistant-ui/tool-group.tsx:105-129`
- **Note:** Not necessarily wrong functionally, but it borrows the ThinkingBlock-only shimmer motif into a surface the design never applies it to.

### 5.10 `LOW` Transcript -> MarkerWrap -> gap between pill and disclosure body — spacing
- **Design:** MarkerWrap: `gap: 8` between the pill and its expanded MarkerBody. — `10-chatcards.jsx:437`
- **Code:** `gap-2` = 4px (spacing-2, compressed scale) — half the design gap. Vertical `my-2.5` (10px) correctly matches design's `margin: '10px 0'`. — `packages/ui/src/features/chat/tools/cards/marker-pill.tsx:21-23`
- **Note:** Outer margin was done right (fractional 2.5=10px, exact match); only the inner gap is compressed-scale and off.

### 5.11 `LOW` Transcript -> TaskCard -> subagent transcript left-indent guide — spacing
- **Design:** `marginLeft: 12, paddingLeft: 14, borderLeft: 2px` for the nested subagent transcript. — `10-chatcards.jsx:638`
- **Code:** `ml-3 border-l-2 pl-3.5` → margin-left 6px (spacing-3, compressed scale; design wants 12px), padding-left 14px (fractional 3.5, correct/exact match), border 2px (matches). — `packages/ui/src/features/chat/tools/cards/TaskCard.tsx:105-113`
- **Note:** The indent guide sits half as far from the toggle button as intended (6px vs 12px); paddingLeft and border width are exact.

### 5.12 `LOW` Transcript -> ToolCard family colors -> Bash icon+tile tint — color
- **Design:** bash icon color #7a7a82 (T.text-ish grey), tile bg `${color}1c` (~11% alpha). — `09-toolcards.jsx:13,72`
- **Code:** `--mf-tool-bash: #7a7a82` (exact hex match) / `--mf-tool-bash-tint: rgba(122,122,130,0.11)` (11% alpha, matches design's ~11% `1c` suffix) — both real tokens, verified in globals.css. — `packages/ui/src/styles/globals.css:119-120`
- **Note:** ✓ matches — included only to document verification; no delta.

### 5.13 `LOW` Transcript -> EditFileCard / WriteFileCard -> diff line tinting — color
- **Design:** Diff add/del rows tinted with translucent overlays directly on card background: `rgba(40,167,69,0.10)` add / `rgba(220,53,69,0.09)` del. — `09-toolcards.jsx:43-45`
- **Code:** Uses pre-baked opaque tokens `--mf-diff-add-bg: #e6f2e5` / `--mf-diff-del-bg: #f8e9e7` (light mode) applied as solid backgrounds, not alpha-blended. — `packages/ui/src/features/chat/tools/shared/diff.tsx:104-113; packages/ui/src/styles/globals.css:141-146`
- **Note:** Visually near-equivalent (pre-baked tints approximate the same overlay color against the card bg) and avoids the CSS-var `/opacity` trap correctly — flagged only as a low-severity intentional token-substitution note, not a real defect.

<details><summary>Coverage notes</summary>

Read both design source files in full (09-toolcards.jsx: TOOL_META/ToolStatus/TcDiffLines/ToolCard/ToolGroup/TurnHeader/ChatTranscript; 10-chatcards.jsx: CardShell/CardHead/ResolvedPill/CardBtn/ThinkingBlock/AskUserQuestionCard/PermissionCard/PlanApprovalCard/MarkerWrap/MarkerPill/MarkerBody/CompactionPill/SkillLoadedCard/SlashCommandCard/WorktreeStatusPill/SchedulePill/MCPToolCard/TaskGroupCard/TaskProgressCard), mainframe-theme.css (full token contract), and component-map.md. On the production side read: shared/chrome.tsx, shared/card-shell.tsx, shared/diff.tsx, tool-group.tsx, tool-fallback.tsx, tool-status.ts, registry.ts, register-cards.ts, tool-dispatch.tsx, group-parts.ts, tool-group-summary.ts, and every card in features/chat/tools/cards/ (EditFileCard, WriteFileCard, ReadFileCard, SearchCard, BashCard, TaskCard, TaskProgressCard, marker-pill.tsx, SkillLoadedCard, WorktreeStatusPillCard, SchedulePillCard, MCPToolCard, SlashCommandCard, PlanCard, AskUserQuestionCard), plus SystemMessage.tsx (CompactionPill/SystemTextPill) and globals.css to verify every `mf-*`/`--color-mf-*` token referenced actually resolves. Converted every spacing/size class to px using the app's compressed integer scale (1=2,2=4,3=6,4=8,5=12,6=16,7=20,8=24) vs standard fractional scale (1.5=6,2.5=10,3.5=14) per the calibration table, cross-checked against `--spacing-*` in globals.css.

NOT checked: the interactive permission-gate cards (PermissionGate/AskUserQuestionGate/PlanGate under features/chat/gates/ — explicitly a separate leaf per app-tauri/CLAUDE.md, out of this area's scope which is display-only tool cards/groups/markers), ThinkingBlock's production equivalent (Reasoning block — noted in CLAUDE.md as native, not this area), and TurnHeader/assistant-message-header (belongs to the messages area, not tool cards). No live render/screenshot was taken; this is a source-level diff per the project's stated preference.

</details>

<a id="area-6"></a>
## 6. Transcript — interactive gate cards (Question, Permission, Plan)

### 6.1 `HIGH` All 3 gates -> GateHead -> icon tile — spacing
- **Design:** CardHead icon tile: width:26, height:26, borderRadius:8 (10-chatcards.jsx:27-29) — `10-chatcards.jsx:27-32`
- **Code:** size-6 = 16px tile (rounded-md=8px radius is correct, but the tile itself is ~40% smaller than spec) — `packages/ui/src/features/chat/gates/shared/GateShell.tsx:43`
- **Note:** Shared by Question/Permission/Plan gate heads — every gate card's icon badge renders visibly undersized vs the artboard.

### 6.2 `HIGH` AskUserQuestionGate/PermissionGate -> GateHead vs body-row left indent — layout
- **Design:** Title left inset = padding 13 + tile 26 + gap 10 = 49px; context/tool-name rows use the SAME 49px left indent so body text visually aligns under the title (10-chatcards.jsx:26-32 head, :166 context row 'padding: 0 14px 4px 49px', :272 tool row 'padding: 0 14px 8px 49px') — `10-chatcards.jsx:166,272`
- **Code:** Head title left inset computes to px-3.5(14)+size-6(16)+gap-2.5(10)=40px, but PermissionGate's ToolNameRow/DetailsDisclosure use pl-12=64px (24px too far right, doesn't align to the head's own 40px), and AskUserQuestionGate's chat-question-text uses only px-3.5=14px (flush left, no indent at all, doesn't align under the title either) — `packages/ui/src/features/chat/gates/shared/GateShell.tsx:40-43; PermissionGate.tsx:18,29; AskUserQuestionGate.tsx:170`
- **Note:** Two different, both-wrong indents in the same card family: Permission over-indents body rows past its own header, AskUserQuestion under-indents (no alignment at all). Neither matches the header's icon-tile+gap baseline the design uses to line body text under the title.

### 6.3 `HIGH` AskUserQuestionGate -> AskQuestionWizard -> radio/checkbox indicator — spacing
- **Design:** Both radio and checkbox indicators are 17x17; checkbox: borderRadius 5, filled ACCENT bg with a real `checkmark` icon (size 11, stroke 2.6, white) when selected; radio: border grows from 1.5px to 5px, no fill/icon (10-chatcards.jsx:189-201) — `10-chatcards.jsx:189-201`
- **Code:** Both indicators are size-4=8px (less than half the design size). Checkbox uses `rounded` (=rounded-sm, 6px) with a plain filled size-2 (4px) square dot instead of a checkmark icon. Radio uses unselected border=1px (default `border`) instead of 1.5px. — `packages/ui/src/features/chat/gates/AskQuestionWizard.tsx:43-60`
- **Note:** This hand-rolled indicator ignores the codebase's own pixel-accurate shared Checkbox primitive (components/ui/checkbox.tsx: h/w-[17px], rounded-[5px], CheckIcon size-[11px] stroke 2.5) which already matches the design almost exactly — that primitive should have been reused instead of a bespoke smaller one.

### 6.4 `HIGH` All 3 gates -> resolved/answered state — state
- **Design:** Once resolved, the card freezes in place: rows/summary dim, a `ResolvedPill` appears in the header (tone good/bad/neutral, e.g. 'Answered' / 'Allowed once' / 'Denied' / 'Always allowed' / 'Running' / 'Revising'), and (for AskUserQuestion) a 'You answered <label>' footer echoes the choice — all inline in the same card (10-chatcards.jsx:42-53,156-247,264-307,358-419) — `10-chatcards.jsx:42-53,164,238-243,266-270,368-372`
- **Code:** ChatGateMount unmounts the gate entirely the instant `front` clears from the pending-permission queue (no frozen/dimmed/pill state at all). AskUserQuestion/Plan get a *different*, differently-styled display card downstream (tools/cards/AskUserQuestionCard.tsx, tools/cards/PlanCard.tsx); plain Permission requests (Bash/Write/etc.) have no resolved echo anywhere in the transcript — the answer is invisible after the fact. — `packages/ui/src/features/chat/gates/ChatGateMount.tsx:8-14`
- **Note:** component-map §7 explicitly lists 'resolved -> collapses to a ResolvedPill' for Permission and 'answered (read-only summary)' for AskUserQuestion as required states. Neither exists as designed; Permission has no resolved trace at all.

### 6.5 `MEDIUM` All 3 gates -> GateHead -> header icon glyph — icon
- **Design:** Icon size 15 inside the 26px tile (10-chatcards.jsx:31) — `10-chatcards.jsx:31`
- **Code:** className="size-4" = 8px glyph inside the 16px tile — `packages/ui/src/features/chat/gates/AskUserQuestionGate.tsx:156; PermissionGate.tsx:98; PlanGate.tsx:192`
- **Note:** Compounds with the tile-size finding — glyph is roughly half the intended size.

### 6.6 `MEDIUM` AskUserQuestionGate -> AskQuestionWizard -> option row — spacing
- **Design:** Option row padding '9px 11px', row-internal gap 11, row borderRadius 8 (10-chatcards.jsx:176-185) — `10-chatcards.jsx:176-185`
- **Code:** px-3 py-2.5 = 6px/10px padding, gap-3 = 6px gap, rounded-lg = 11px radius — `packages/ui/src/features/chat/gates/AskQuestionWizard.tsx:38-41`
- **Note:** Vertical padding (10px) overshoots design's 9px only slightly, but horizontal padding (6px) is well under the 11px spec, and radius (11px) overshoots the 8px spec — rows read visually tighter/rounder than the artboard.

### 6.7 `MEDIUM` AskUserQuestionGate -> single-select, single-question flow — behavior *(adjusted by verifier)*
- **Design:** Single-select (non-multi, non-Other) resolves immediately on option click — no Submit button is ever shown for this case; `needsSubmit = multi || otherActive` (10-chatcards.jsx:129-149,228) — `10-chatcards.jsx:139-149,228`
- **Code:** Every question (including single-select/single-question) requires an explicit Submit click; Submit is always rendered and disabled until a selection exists — `packages/ui/src/features/chat/gates/AskUserQuestionGate.tsx:66-91; confirmed by __tests__/AskUserQuestionGate.test.tsx:118-136 ('submit is shown and disabled until selection' for a single question)`
- **Note:** A deliberate, tested behavior change from the prototype's one-click resolve — worth confirming is intentional, since it adds an extra click for the most common (single-select) case.
- **Verifier correction:** The artboard (10-chatcards.jsx:133,147) does resolve single-select on click with no Submit, and the code does always require Submit — both sides accurately read. But the design package's own contract, component-map.md §7 ('Ask-user-question card', line 167), explicitly prescribes the shipped behavior: 'multi-question requests page with Next → Submit; Submit disabled until a selection exists; Skip → onRespond(deny)' — and lists single-vs-multi-question nav and disabled-vs-enabled submit as required states (line 168), none of which the 10-chatcards illustration implements. The code follows the component-map contract, so this is a sanctioned divergence from the illustration, not an unreviewed behavior change; severity should drop to low/informational.

### 6.8 `MEDIUM` PermissionGate -> Details disclosure -> pretty-printed JSON block — color
- **Design:** JSON block uses the dark terminal palette: background T.termBg, text T.termFg (10-chatcards.jsx:287-291) — `10-chatcards.jsx:287-291`
- **Code:** bg-mf-raised (light warm-paper raised surface) / text-foreground — not the terminal palette — `packages/ui/src/features/chat/gates/PermissionGate.tsx:39-45`
- **Note:** --mf-term-bg/--mf-term-fg are real tokens (globals.css:75-76) and are used elsewhere (terminal pane) — the raw tool-input block should read as 'code/terminal' chrome per the design, not as a plain raised card.

### 6.9 `MEDIUM` All 3 gates -> GateCardShell max-width — layout
- **Design:** CardShell is capped at maxWidth: 680 so the card reads as a compact inline element in the transcript, not full message-column width (10-chatcards.jsx:16) — `10-chatcards.jsx:16`
- **Code:** No max-width on GateCardShell; it stretches to fill the thread's max-w-3xl (768px) column — `packages/ui/src/features/chat/gates/shared/GateShell.tsx:11-21; parent width from packages/ui/src/features/chat/thread/ChatThread.tsx:82`

### 6.10 `MEDIUM` PlanExecModeControl -> segmented control — spacing
- **Design:** Outer container: padding 2, gap 2, borderRadius 8; per-icon size 12 (10-chatcards.jsx:321-336) — `10-chatcards.jsx:321-336`
- **Code:** p-0.5/gap-0.5 = 2px/2px (correct), but outer rounded-lg = 11px (vs 8px spec), and icon className="size-3" = 6px (half the 12px spec) — `packages/ui/src/features/chat/gates/PlanExecModeControl.tsx:27,46`
- **Note:** Same icon-halving pattern as the GateHead tile icon — systemic across the gate family's small icon usages.

### 6.11 `MEDIUM` PlanGate -> ActionRow — extra-element
- **Design:** Only two actions when unresolved: 'Approve & run' (primary, flex) and 'Keep planning' (ghost, icon pencil) — 'Keep planning' dismisses straight to a 'Revising' ResolvedPill, no feedback textarea in the card (10-chatcards.jsx:407-410, 368-372) — `10-chatcards.jsx:407-410`
- **Code:** Three buttons — Approve & run / Keep planning / Reject — where Keep planning opens an inline feedback Textarea + Cancel/Send-feedback row (ReviseRow) instead of dismissing — `packages/ui/src/features/chat/gates/PlanGate.tsx:89-153,223-231`
- **Note:** component-map §7 does sanction a 'denied-with-feedback' action (Deny with optional feedback string), so the underlying capability is contractually real — but the design's card shows no third button and no feedback-textarea sub-state; the on-card form is an invented UI beyond both refs and should be reconciled with product/design before shipping as-is.

### 6.12 `LOW` PermissionGate/GateShell -> card shadow (unresolved state) — shadow
- **Design:** Unresolved card shadow is an accent-tinted glow: `0 1px 0 rgba(0,0,0,0.02), 0 6px 22px -12px ${accent}55` — colored per gate (blue for Question/Plan, amber for Permission) (10-chatcards.jsx:16-19) — `10-chatcards.jsx:16-19`
- **Code:** shadow-[var(--mf-shadow-pop)] — a generic dark popover/menu shadow (0 16px 40px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.14) in light mode), identical for all three gate types and not accent-tinted — `packages/ui/src/features/chat/gates/shared/GateShell.tsx:14`
- **Note:** Loses the per-gate-type colored glow that signals 'this is a live, awaiting-response card' distinct from ordinary popovers.

### 6.13 `LOW` PlanGate -> Details/JSON/Details chevron (PermissionGate) sizes — icon
- **Design:** Disclosure chevron size 11 (10-chatcards.jsx:284) — `10-chatcards.jsx:284`
- **Code:** className="size-3" = 6px — `packages/ui/src/features/chat/gates/PermissionGate.tsx:35`

### 6.14 `LOW` PlanGate -> plan body / numbered steps — missing-element
- **Design:** PlanApprovalCard renders an enumerated steps list (numbered circle badges + optional touched-file code chips per step) below the summary (10-chatcards.jsx:378-399) — `10-chatcards.jsx:358-399`
- **Code:** Renders the raw `plan` markdown string only, no discrete step list/file chips — `packages/ui/src/features/chat/gates/PlanGate.tsx:49-59`
- **Note:** NOT flagged as a real bug: component-map §7 states the real ControlRequest only carries `plan: string` (markdown) — there is no backend `steps[]`/per-step files array, so the prototype's numbered-steps illustration isn't backed by real data ('the honesty rule'). Markdown rendering is the correct, honest choice here; listed for completeness only.

### 6.15 `LOW` PlanClearContextCheck — spacing *(adjusted by verifier)*
- **Design:** Checkbox indicator 16x16, borderRadius 6, border 1.5px; label fontSize 12, fontWeight 500, color T.text2 (10-chatcards.jsx:346-353) — `10-chatcards.jsx:343-355`
- **Code:** Uses the shared Checkbox primitive (17x17, rounded-[5px], border-[1.5px]) — 1px oversized / 1px-undersized radius vs the plan-specific spec; label uses text-label text-muted-foreground with no font-weight override (default 400, not 500) — `packages/ui/src/features/chat/gates/PlanClearContextCheck.tsx:14-23; packages/ui/src/components/ui/checkbox.tsx:10`
- **Verifier correction:** The size drift is real (shared Checkbox is 17x17 rounded-[5px] vs the plan-specific 16x16 radius-6 spec; border 1.5px matches). But the font-weight claim is wrong: the shared Label primitive (packages/ui/src/components/ui/label.tsx) applies 'text-label font-medium leading-none', and PlanClearContextCheck's appended 'text-label text-muted-foreground' does not override font-medium — so the label renders at weight 500, matching the design's fontWeight 500 (10-chatcards.jsx:353). Remaining label drift is only color (text-muted-foreground vs T.text2) and line-height (leading-none vs default).

### 6.16 `LOW` All 3 gates -> reveal transitions — state
- **Design:** Other free-text input, Details JSON panel, and the submit/footer row all mount with a `tw-slidein` animation on reveal (10-chatcards.jsx:211,229,237,287) — `10-chatcards.jsx:211,229,237,287`
- **Code:** No enter animation/transition classes on the Other input reveal, Details `<pre>` reveal, or PlanGate's ReviseRow reveal — they appear instantly — `packages/ui/src/features/chat/gates/AskQuestionWizard.tsx:106-115; PermissionGate.tsx:38-46; PlanGate.tsx:223-229`

### 6.17 `LOW` PlanGate -> GateHead icon — icon
- **Design:** icon="checklist.box" — a rounded square containing a checkmark (01-base.jsx:473: rect + check path), i.e. a checklist/checkbox glyph — `10-chatcards.jsx:367; 01-base.jsx:473`
- **Code:** ClipboardListIcon (lucide) — a clipboard-with-lines glyph, a different icon family (clipboard vs. checkbox-in-a-box) — `packages/ui/src/features/chat/gates/PlanGate.tsx:2,192`
- **Note:** Plausible-but-different glyph; both read as 'plan/checklist' at a glance but are not the same shape as the artboard's rounded-square-with-check.

### 6.18 `LOW` GateHead -> title typography — typography
- **Design:** title: fontSize 13, fontWeight 600, letterSpacing -0.15, lineHeight 1.3 (10-chatcards.jsx:35) — `10-chatcards.jsx:35`
- **Code:** text-body(13px) font-semibold(600) leading-tight(1.15) — matches size/weight but no tracking-tight applied (letter-spacing stays default 0 vs -0.15) and line-height is 1.15 vs 1.3 — `packages/ui/src/features/chat/gates/shared/GateShell.tsx:49`

<details><summary>Coverage notes</summary>

Read 10-chatcards.jsx in full (CardShell/CardHead/ResolvedPill/CardBtn, AskUserQuestionCard, PermissionCard, ExecModeSeg/ClearContextCheck/PlanApprovalCard) and component-map.md §7 (state inventory / behavioral contract for Permission, AskUserQuestion, Plan). Compared against the live gate implementation: ChatGateMount.tsx, AskUserQuestionGate.tsx, AskQuestionWizard.tsx, PermissionGate.tsx, PlanGate.tsx, PlanExecModeControl.tsx, PlanClearContextCheck.tsx, shared/GateShell.tsx, shared/GateButton.tsx, answers.ts, select-front.ts, build-control-response.ts, plus the shared Checkbox primitive (components/ui/checkbox.tsx) and the post-resolution display cards (tools/cards/AskUserQuestionCard.tsx, tools/cards/PlanCard.tsx). Verified every spacing/radius/icon-size class against the compressed scale and real token names in packages/ui/src/styles/globals.css (--spacing-N, --radius-*, --mf-* block, --text-* rungs). Read the gate test suite (AskUserQuestionGate.test.tsx) to confirm implemented behavior (single-select requires explicit Submit, contrary to the jsx). Did not run the live app / take screenshots — this is a source-level px/token diff per the calibration rules; visually-compounding effects (e.g. stacked size deltas) are reasoned from computed px, not rendered pixels.

</details>

<a id="area-7"></a>
## 7. Transcript — user message states

### 7.1 `HIGH` User Message -> Text turn -> @mention rendering — color
- **Design:** umMentions(): @token rendered as plain inline text, no box/border/icon — `<span style={{ color: ACCENT, fontWeight: 600 }}>{p}</span>` (11-usermessages.jsx:23-27) — `11-usermessages.jsx:23-27`
- **Code:** Every @mention is rendered via the shared `DirectiveChip` (bg-mf-chip, border border-border, rounded-md, padding, plus an AtSign icon) — the same boxed treatment used for /command chips, because `mainframeUserFormatter`'s `mention` segments feed the same `createDirectiveText` chip renderer as `command` segments. — `packages/ui/src/components/ui/assistant-ui/directive-text.tsx:36-56; packages/ui/src/features/chat/messages/UserMessage.tsx:65-70`

### 7.2 `HIGH` User Message -> Queued turn -> FIFO stack (position/total) — behavior
- **Design:** UMQueuedStack injects `position`/`total` into every queued sibling, driving UMQueuedMeta's ordinal labels ("sends next…", "2nd to send") and steady vs spinning dot per item; stack items separated by `gap: 15`. — `11-usermessages.jsx:137-153, 182-190`
- **Code:** `UserMessage.tsx` calls `<QueuedUserTurn messageId={...} content={...} extrasSlot={extras}>` with no `position`/`total`/`sending` props — every queued message defaults to `position=1, total=1`, so the ordinal/'sends next' labels and the steady-dot-for-later-items behavior are structurally unreachable. No FIFO-stack wrapper exists anywhere in the codebase (`grep` for `UMQueuedStack`/`QueuedStack` returns nothing) and no controller computes per-chat queue depth. — `packages/ui/src/features/chat/messages/UserMessage.tsx:274-276; packages/ui/src/features/chat/messages/QueuedUserTurn.tsx:115-135`

### 7.3 `MEDIUM` User Message -> Attachments -> file pill (UMFileThumb) -> right padding — spacing
- **Design:** padding: '6px 12px 6px 6px' (right padding 12px) — `11-usermessages.jsx:211`
- **Code:** `py-1.5 pl-1.5 pr-3` — `pr-3` resolves to the compressed integer scale (3 → 6px), not 12px. — `packages/ui/src/features/chat/messages/UserAttachments.tsx:37`

### 7.4 `MEDIUM` User Message -> Attachments -> file pill -> ext icon tile size — spacing
- **Design:** 36×36 icon tile (`width: 36, height: 36`) — `11-usermessages.jsx:212`
- **Code:** `size-9` — compressed scale index 9 = 32px, 4px short of the design's 36px tile. Suggested fix: `size-[36px]`. — `packages/ui/src/features/chat/messages/UserAttachments.tsx:40`

### 7.5 `MEDIUM` User Message -> /command or /skill pill (SlashPill) — spacing
- **Design:** padding: '2px 8px 2px 6px', gap: 5, marginRight: 8 between pill and message text — `11-usermessages.jsx:73-76`
- **Code:** `mr-2 inline-flex items-center gap-1 rounded-md py-0.5 pl-1.5 pr-2` — `mr-2`=4px (design 8px), `gap-1`=2px (design 5px, icon crowds the /name text), `pr-2`=4px (design 8px right padding). Suggested fix: `mr-[8px] gap-[5px] pl-[6px] pr-[8px]`. — `packages/ui/src/features/chat/messages/UserMessage.tsx:135`

### 7.6 `MEDIUM` User Message -> Queued turn -> action row (Edit/Cancel) to bubble gap — spacing
- **Design:** gap: 8 between the Edit/Cancel action group and the pending bubble — `11-usermessages.jsx:163`
- **Code:** `flex items-center gap-2` = 4px, half the design's 8px. — `packages/ui/src/features/chat/messages/QueuedUserTurn.tsx:151`

### 7.7 `MEDIUM` User Message -> Text turn -> inter-message vertical spacing — spacing
- **Design:** UMTextTurn wraps every user turn with `marginBottom: 16` for spacing to the next element in the transcript. — `11-usermessages.jsx:47`
- **Code:** `MessagePrimitive.Root` uses `pt-2` (4px) as its only top spacing — no 16px-equivalent bottom margin/gap exists anywhere in the render path (confirmed no wrapper adds it in `bounded-messages.tsx`). Net visible gap between consecutive user turns is ~4px vs the design's 16px. — `packages/ui/src/features/chat/messages/UserMessage.tsx:268`

### 7.8 `MEDIUM` User Message -> Code-reference / review-comment snippet -> big-snippet clamp — state
- **Design:** UMCodeRef clamps snippets longer than `collapsedLines` (7) behind a fade + 'Show all N lines' expander button (scrollable when expanded, max-height 240px). — `11-usermessages.jsx:324-365`
- **Code:** `ReviewCommentCard`/`SnippetLines` render the full snippet unconditionally with no line-count clamp, no fade, and no expand/collapse affordance — a long code-review snippet renders at full height every time. — `packages/ui/src/features/chat/messages/code-snippet.tsx:1-19; packages/ui/src/features/chat/messages/ReviewCommentCard.tsx:28-49`

### 7.9 `MEDIUM` User Message -> 'Implementing plan' turn (UMPlanBubble) — missing-element
- **Design:** First message of a plan-implementing session renders as a distinct card: green checklist icon chip, 'Implementing plan' heading, green 'Approved' pill, hairline-divided Markdown body. — `11-usermessages.jsx:85-98`
- **Code:** Explicitly deferred — `UserMessage.tsx` carries a `TODO(leaf): PLAN_PREFIX card ("Implementing plan") — deferred to plan-card leaf` comment; no plan-card variant exists in the render path. — `packages/ui/src/features/chat/messages/UserMessage.tsx:225`

### 7.10 `LOW` User Message -> Queued turn -> QueuedAction icon-to-label gap — spacing
- **Design:** gap: 4 between icon and label inside each Edit/Cancel ghost pill; borderRadius: 7 — `11-usermessages.jsx:126`
- **Code:** `gap-1` = 2px (half of design's 4px); `rounded-md` = 8px vs design's 7px. — `packages/ui/src/features/chat/messages/QueuedUserTurn.tsx:51-52`

### 7.11 `LOW` User Message -> Read-more button -> icon/label gap and bubble spacing — spacing
- **Design:** gap: 4 between 'Read more'/'Show less' label and its chevron icon; gap: 5 between the card and the button (flex column). — `11-usermessages.jsx:48, 56`
- **Code:** `gap-0.5` = 2px for icon/label (design 4px); `mt-1` = 2px separates the button from the bubble via margin rather than the design's 5px flex gap. — `packages/ui/src/features/chat/messages/ReadMoreBubble.tsx:79, 89`

### 7.12 `LOW` User Message -> /command chip background tint — color
- **Design:** Command pill background = `${ACCENT}14` (~7.8% alpha of the brand accent), matching the skill pill's own dedicated tint treatment (`${c}14`). — `11-usermessages.jsx:70-73`
- **Code:** Command pill reuses the shared `--mf-selection` token (10% alpha, defined as the text-selection highlight color) instead of a purpose-built ~8% accent tint — skill's `--mf-directive-skill-tint` (8% alpha) is faithful, but command's `bg-mf-selection` is a coarser reuse and slightly stronger than intended. — `packages/ui/src/features/chat/messages/UserMessage.tsx:132; packages/ui/src/styles/globals.css:57`

### 7.13 `LOW` User Message -> Sandbox context chip (inspect/capture) padding & radius — spacing
- **Design:** UM_CTX: padding '4px 9px 4px 4px', gap: 7, borderRadius: 8, maxWidth: 250 — `11-usermessages.jsx:233`
- **Code:** `ImageAttachment`'s context chip: `gap-2 rounded-lg ... py-1 pl-1 pr-2.5 ... max-w-[280px]` — `gap-2`=4px (design 7px), `rounded-lg`=11px (design 8px = rounded-md), `py-1`/`pl-1`=2px (design 4px), `max-w-[280px]` is 30px wider than design's 250. — `packages/ui/src/features/chat/messages/UserAttachments.tsx:80-84`

<details><summary>Coverage notes</summary>

Read the full design ground truth (/tmp/parity-audit/design-current/11-usermessages.jsx, all 374 lines) plus mainframe-theme.css and the relevant component-map.md excerpt (line 41, §warm-chrome). Cross-checked every real `--mf-*`/`--color-mf-*` token used in production (UserMessage.tsx, UserAttachments.tsx, QueuedUserTurn.tsx, ReadMoreBubble.tsx, ReviewCommentCard.tsx, code-snippet.tsx, user-directives.ts, directive-text.tsx, file-ext-colors.ts, attachment.tsx, ComposerEditMode.tsx) against packages/ui/src/styles/globals.css to confirm no phantom/undefined tokens and no `/opacity` modifiers on CSS-var colors — none found (clean on that dimension). Verified every integer/fractional Tailwind spacing and radius class against the compressed scale (spacing 1=2·2=4·3=6·4=8·5=12·6=16·7=20·8=24·9=32·10=40, fractionals standard, radius xs4·sm6·md8·lg11·xl13) rather than assuming standard Tailwind. Verified icon choices (Wrench/Zap/PencilIcon/XIcon/ChevronDown/ChevronsUpDown/AtSign) against the design's named glyphs — all lucide mappings are correct; the AtSign icon itself is the defect (it shouldn't render at all for plain-text mentions). Verified data-testid coverage on every interactive element (message root, attachments, read-more toggle, queued edit/cancel, composer-edit controls, retry) — all present and domain-keyed, no gaps found. Verified the CoolCard shell (background/border/radius/shadow/padding/typography incl. --leading-loose:1.58 override) matches the design almost exactly, and that `--mf-um-card`/`--mf-um-edge`/`--mf-um-dash`/`--mf-shadow-user-card`/`--mf-directive-skill(-tint)` all resolve to real theme values across all 6 mode×scheme combinations. NOT verified: live pixel screenshots (per the prototype README, source comparison was prioritized over rendering); dark-mode/ocean/velvet-scheme-specific rendering (token values were spot-checked in globals.css only, assumed to inherit the same structural drifts found in classic-light since the component code is scheme-agnostic); ComposerEditMode's pixel styling has no corresponding artboard inside 11-usermessages.jsx so was checked only for behavioral sanity, not pixel parity; UserMessageAttachments in attachment.tsx confirmed dead/unreferenced code, excluded from findings.

</details>

<a id="area-8"></a>
## 8. Composer — input shell + config toolbar

### 8.1 `MEDIUM` Composer -> Bottom toolbar -> attachment/config left slot — missing-element
- **Design:** Two separate 22×22 gActionStyle icon buttons: paperclip (Icon 'paperclip' size 12) AND at-sign (Icon 'at' size 12) side by side, before the divider and config chips (03-content.jsx:753-758). — `03-content.jsx:753-758`
- **Code:** Only ComposerAddAttachment (paperclip) is wired in the toolbar left slot; there is no dedicated '@' icon button. '@' is implemented only as a typed trigger character inside the textarea (ComposerTriggers.tsx TP char="@"), not as a clickable toolbar affordance. — `packages/ui/src/features/chat/composer/Composer.tsx:150-156`

### 8.2 `MEDIUM` Composer -> Bottom toolbar -> Plan mode / Features (⚙) / Worktree trigger shape — radius
- **Design:** PlanModeToggle, FeaturesPopover trigger, and WorktreeButton are all 26×20 rectangular icon buttons with borderRadius:6 (RADIUS.sm) — visually distinct 'squarish' icon buttons vs. the pill-shaped label chips (ModelSelector/ComposerSelect use borderRadius:11). — `03-content.jsx:413-428 (PlanModeToggle), 533-543 (FeaturesPopover trigger), 599-608 (WorktreeButton)`
- **Code:** All three use rounded-[11px] (the pill radius, RADIUS.full-ish/matches the label chips), not RADIUS.sm(6px): PlanModeToggle 'rounded-[11px] border-[0.5px]...px-[6px]' (no fixed width, auto-sized instead of 26px), FeaturesPopover trigger 'rounded-[11px]...px-[7px]', WorktreePopover trigger 'rounded-[11px]...px-[6px]'. This is a systematic drift repeated across 3 icon-only controls — they now read as small pills identical in shape to the text-bearing chips instead of a distinct icon-button family. — `packages/ui/src/features/chat/composer/config-toolbar/PlanModeToggle.tsx:42-49; FeaturesPopover.tsx:75-84; WorktreePopover.tsx:153-160`

### 8.3 `MEDIUM` Composer -> Input -> placeholder copy — text
- **Design:** Default empty-composer placeholder is 'Reply to Mainframe…' ('Add a message…' when quotes are pending). — `03-content.jsx:747`
- **Code:** Placeholder is always 'Type @ to search files, / for skills…', regardless of quote state. — `packages/ui/src/features/chat/composer/Composer.tsx:142`

### 8.4 `LOW` Composer -> Bottom toolbar -> Worktree trigger icon size — icon
- **Design:** WorktreeButton uses Icon name='folder.git' size={13}. — `03-content.jsx:606`
- **Code:** GitFork rendered at size={11}. — `packages/ui/src/features/chat/composer/config-toolbar/WorktreePopover.tsx:162`

### 8.5 `LOW` Composer -> Bottom toolbar -> Send button icon — icon *(adjusted by verifier)*
- **Design:** Send button: Icon name='arrow.up' size={13} stroke={2.2} inside a 26×26 accent square. — `03-content.jsx:798`
- **Code:** ArrowUpIcon rendered with className="size-4" (16px) and default stroke-width (2, via lucide default) inside a matching size-[26px] rounded-md button — icon is oversized relative to the 26px button vs. the design's 13px glyph. — `packages/ui/src/features/chat/composer/Composer.tsx:50`
- **Verifier correction:** Drift is real but the direction is inverted: `size-4` resolves to 8px, not 16px, because the app overrides the integer spacing scale (--spacing-4: 8px in packages/ui/src/styles/globals.css:777). The ArrowUpIcon in Composer.tsx:50 renders at 8px inside the 26px button — UNDERSIZED vs the design's 13px glyph (03-content.jsx:798), not oversized. The stroke-width detail (lucide default 2 vs design 2.2) stands.

### 8.6 `LOW` Composer -> Bottom toolbar -> Add-attachment icon size — icon *(adjusted by verifier)*
- **Design:** gActionStyle 22×22 button hosts Icon name='paperclip' size={12}. — `03-content.jsx:753-754`
- **Code:** ComposerAddAttachment is a 22×22 button (size-[22px], matches) but the Paperclip glyph is size-4 (16px), noticeably larger than the design's 12px glyph inside the same button footprint. — `packages/ui/src/components/ui/assistant-ui/attachment.tsx:185-187`
- **Verifier correction:** Drift is real but the direction is inverted: the Paperclip's `size-4` (attachment.tsx:187) resolves to 8px under the compressed spacing scale (--spacing-4: 8px, globals.css:777), not 16px. The glyph is SMALLER than the design's 12px paperclip (03-content.jsx:753-754), not 'noticeably larger'. The 22px button footprint match is correct.

### 8.7 `LOW` Composer -> Edit mode -> muted config toolbar treatment — state
- **Design:** While editing a queued message, the config-chip row is shown at opacity 0.4 AND filter: saturate(0.6) with pointer-events none, so colored controls (amber Plan toggle, accent-active Features/Worktree dots) visibly desaturate as well as dim. — `03-content.jsx:759-761`
- **Code:** ComposerEditMode wraps ComposerToolbar in only `opacity-50` + `pointer-events-none` (no desaturation filter), so colored/active chips (amber, primary-tinted) stay fully saturated at 50% opacity instead of the design's dimmer, greyed-out 0.4×saturate(0.6) treatment. — `packages/ui/src/features/chat/composer/edit/ComposerEditMode.tsx:82-84`

### 8.8 `LOW` Composer -> Config controls -> disabled-while-running — behavior
- **Design:** component-map.md §7 state inventory: 'all controls disabled while running' is listed as one of the composer config states. — `component-map.md:189`
- **Code:** PermissionSelect and PlanModeToggle are explicitly NOT disabled while the chat is running (each carries an in-code comment: 'NOT disabled while the chat is running — can be changed for the next turn' / 'takes effect on the next user turn'), while ProviderModelSelect/EffortPicker/FeaturesPopover DO disable. This is a deliberate, documented product decision (next-turn semantics) rather than an omission, but it diverges from the written state-inventory contract and should be confirmed/updated in the spec rather than silently left inconsistent. — `packages/ui/src/features/chat/composer/config-toolbar/PermissionSelect.tsx:8; PlanModeToggle.tsx:7-8`

<details><summary>Coverage notes</summary>

Read design ground truth in full: 03-content.jsx (Composer/ComposerBody/ModelSelector/ComposerSelect/PlanModeToggle/EffortPicker/FeaturesPopover/WorktreeButton, lines 1-849), 01-base.jsx tokens (RADIUS/SPACE/FS/T color blocks, icon switch cases for shield/gauge/clipboard/sliders/folder.git/chevron.down/paperclip/at/arrow.up/lock), 02-chrome.jsx gActionStyle, component-map.md §0/§2/§5/§7 (composer config contract + state inventory), and artboards/Composer States.html (confirmed it loads the same 03-content.jsx Composer live, not a separate mock — so 03-content.jsx is authoritative ground truth for every state: empty/locked/typing/edit-loaded/edit-text/sandbox-captures/per-model tuning). Compared against production: Composer.tsx, config-toolbar/{ComposerToolbar,ProviderModelSelect,PermissionSelect,PlanModeToggle,EffortPicker,FeaturesPopover,WorktreePopover,WorktreeNewForm,WorktreeExistingTab,use-composer-tuning}.tsx, edit/ComposerEditMode.tsx, triggers/ComposerTriggers.tsx, components/ui/assistant-ui/attachment.tsx, and globals.css token/radius/spacing tables. Cross-checked composer-states.test.tsx for behavior coverage. Did not run/screenshot the live app (source comparison only, per prototype README guidance); did not audit ComposerHighlight.tsx render-highlights internals or the quote.tsx SelectionToolbar in depth since component-map explicitly marks Quote as a native-match not owned by this area's controls.

</details>

<a id="area-9"></a>
## 9. Right Inspector — Tasks drawer + Tasks board/list + task modal

### 9.1 `HIGH` Right Inspector -> Tasks board (full-view modal) -> header — missing-element
- **Design:** Header's first element is a borderless 15px xmark icon button, title 'Close (Esc)', to the left of the checklist icon/title — `12-todos.jsx:714-717`
- **Code:** TasksBoard.tsx header has no close button at all; the hosting Dialog is opened with `hideClose`, and TasksBoard itself never renders a replacement — the modal can only be dismissed via Escape or backdrop click, with zero visible close affordance — `packages/ui/src/features/tasks/TasksModalHost.tsx:69 (hideClose); packages/ui/src/features/tasks/TasksBoard.tsx:70-123`

### 9.2 `HIGH` Right Inspector -> Tasks board -> List/Board segmented switch, board width — layout
- **Design:** Modal width animates from 880px (list view) to 90% / max 1200px (board view) — `width: view === 'list' ? 880 : '90%', maxWidth: view === 'list' ? '94vw' : 1200, transition: 'width .18s ease'` — `12-todos.jsx:710-712`
- **Code:** Dialog is a fixed `max-w-4xl` (896px) regardless of view — board view never gets the wider 3-column layout the design intends, so kanban columns are cramped into list-view width — `packages/ui/src/features/tasks/TasksModalHost.tsx:69`

### 9.3 `HIGH` Right Inspector -> Tasks -> type/priority/status tint palette (badges, pills, dots, stripes) — color
- **Design:** Warm-chrome-tuned hex tints per type/priority, e.g. bug=#c4302b @10%, feature=ACCENT @10%, enhancement=#7b3ff2 @10%, question=#b9770e @12%, duplicate=#c2540a @10%, priority dots critical=#c4302b/high=#e8730f/medium=#e0a019/low=#c4c2bd — a bespoke tint system, not generic Tailwind swatches — `12-todos.jsx:12-27`
- **Code:** task-palettes.ts uses generic Tailwind named-color classes (`bg-red-100 text-red-700 dark:bg-red-900`, `bg-blue-100`, `bg-purple-100`, `bg-yellow-100`, `bg-orange-100`) for every status/type/priority tint and every priority-dot/status-dot color — none of the actual design hex values are used, and no warm-chrome tint token (there is no --mf-amber/--mf-purple etc. in globals.css) backs any of it — `packages/ui/src/features/tasks/task-palettes.ts:17-105 (all 5 functions: statusTint, typeTint, priorityTint, priorityDotClass, statusDotColor)`

### 9.4 `HIGH` Right Inspector -> Tasks -> priority sort rank order — behavior *(adjusted by verifier)*
- **Design:** TD_PRI_RANK = { critical: 0, high: 1, medium: 2, low: 3 } — ascending priority sort surfaces Critical first — `12-todos.jsx:35`
- **Code:** PRIORITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } — inverted; ascending priority sort in the app surfaces Low first, the opposite of design intent. This is a functional bug, not just a cosmetic delta: choosing 'Priority ascending' never puts urgent tasks on top. — `packages/ui/src/features/tasks/todos-filters.ts:26`
- **Verifier correction:** The rank inversion is real and both refs are accurate (12-todos.jsx:35 TD_PRI_RANK critical=0 vs todos-filters.ts:26 PRIORITY_RANK low=0), but 'functional bug: urgent tasks can never be put on top' overstates it: the app's SortMenu exposes explicit '↑ Ascending'/'↓ Descending' items per key (SortMenu.tsx:59-82), so 'Priority ↓ Descending' does surface critical first, and code's asc=low-first is internally consistent with its own labels. The real drift is a convention inversion vs the design (where dir:'asc' + rank critical=0 = critical-first), which bites only if the design's default sort {priority, asc} (12-todos.jsx:674) is ported without also flipping the rank. Severity medium, not high.

### 9.5 `MEDIUM` Right Inspector -> Tasks drawer -> header icon — icon
- **Design:** circle.dotted glyph (dashed-outline circle) in --muted-foreground, per prompt-sidebar-panel-headers.md §2: 'small circle.dotted-style icon in --muted-foreground' — `prompt-sidebar-panel-headers.md:39-40; 01-base.jsx:512 (circle.dotted def)`
- **Code:** TasksGlyph — a solid checkbox-with-checkmark glyph (rect + check path, same shape as the 'checklist.box' icon), rendered in text-primary (accent), not muted-foreground — `packages/ui/src/features/tasks/TasksDrawer.tsx:117; packages/ui/src/layout/surface-icons.tsx:93-100`

### 9.6 `MEDIUM` Right Inspector -> Tasks drawer -> header 'TASKS' label — typography
- **Design:** Uppercase 'TASKS' label, ~11px, weight 600, letter-spacing 0.4px, color --muted-foreground — `prompt-sidebar-panel-headers.md:40-41; 04-engine.jsx:144-147 (textTransform: 'uppercase', letterSpacing: 0.4, color: T.text2)`
- **Code:** 'Tasks' rendered mixed-case (no text-transform: uppercase, no tracking utility), text-caption (11px ✓) font-semibold (600 ✓) but color text-foreground, not muted-foreground — `packages/ui/src/features/tasks/TasksDrawer.tsx:118`

### 9.7 `MEDIUM` Right Inspector -> Tasks drawer -> header active-count badge — spacing
- **Design:** Active count in a pill chip: padding 2px 6px, radius 8px, background var(--mf-chip), tabular-nums — `prompt-sidebar-panel-headers.md:41-42; 04-engine.jsx:148-152`
- **Code:** Bare `<span className="font-mono text-micro text-mf-text-3">{activeCount}</span>` — no background, no padding, no border-radius, no tabular-nums class — `packages/ui/src/features/tasks/TasksDrawer.tsx:119`

### 9.8 `MEDIUM` Right Inspector -> Tasks board -> header row — spacing
- **Design:** height: 52 (fixed), padding: '0 16px', gap: 12 between header items — `12-todos.jsx:714`
- **Code:** No fixed height (auto via px-4 py-3), padding resolves to 8px horizontal / 6px vertical (spacing-4/spacing-3 compressed), gap-2 = 4px — every header metric is ~30-60% smaller than the artboard, producing a visibly denser/cramped header — `packages/ui/src/features/tasks/TasksBoard.tsx:72`

### 9.9 `MEDIUM` Right Inspector -> Tasks -> default sort on open — behavior
- **Design:** Default sort state is `{ key: 'priority', dir: 'asc' }` (priority-first ordering, most-urgent visible immediately, given TD_PRI_RANK critical=0) — `12-todos.jsx:674`
- **Code:** DEFAULT_SORT = `{ key: 'number', dir: 'desc' }` — board/list open sorted by newest task number first, not by priority — `packages/ui/src/features/tasks/use-todos-store.ts:32`

### 9.10 `LOW` Right Inspector -> Tasks board -> header active/done count chip — color
- **Design:** font-mono, fontSize 11, color T.text3, padding '2px 8px', radius 8, background T.chipBg (var(--mf-chip)) — `12-todos.jsx:722`
- **Code:** `text-caption text-muted-foreground bg-muted rounded-full px-2 py-0.5` — uses shadcn `bg-muted`/`rounded-full` (pill) instead of the warm-chrome chip token and rounded-md/8px radius; not font-mono — `packages/ui/src/features/tasks/TasksBoard.tsx:75-77`

### 9.11 `LOW` Right Inspector -> Tasks -> sort menu (list/board header) — behavior
- **Design:** TdSortMenu — single button showing current sort key label + a direction arrow icon; clicking a menu row toggles direction if already selected, otherwise picks the key with a sensible default direction (single active choice, cycles in place) — `12-todos.jsx:246-282`
- **Code:** SortMenu renders a full 4-key x 2-direction (asc/desc) list — 8 separate menu items each with its own checkmark — a materially different interaction model (explicit direction picker per key vs single-toggle-per-key) — `packages/ui/src/features/tasks/SortMenu.tsx:38-88`

### 9.12 `LOW` Right Inspector -> Tasks -> filter chips (Type/Priority/Label) selected-count badge — layout
- **Design:** TdMenuBtn count badge is a distinct pill: font-mono, 10px, weight 700, color ACCENT, background rgba(ACCENT,0.18), radius 6, padding '0 5px', height 15 — `12-todos.jsx:196-208`
- **Code:** FilterMenu renders the count as plain inline parenthetical text `(N)` appended to the label — no pill, no background, no separate typography — `packages/ui/src/features/tasks/FilterMenu.tsx:58`

### 9.13 `LOW` Right Inspector -> Tasks -> filter bar search input placeholder — text
- **Design:** 'Search tasks…' — `12-todos.jsx:294`
- **Code:** 'Filter by title…' — `packages/ui/src/features/tasks/TasksFilterBar.tsx:107`

### 9.14 `LOW` Right Inspector -> Tasks -> Board card grid gap — spacing
- **Design:** Card list gap: 9px (`gap: 9` in the column body flex) — `12-todos.jsx:621`
- **Code:** `gap-2` = 4px (compressed spacing-2) — cards sit noticeably closer together than the artboard — `packages/ui/src/features/tasks/TaskColumn.tsx:76`

### 9.15 `LOW` Right Inspector -> Tasks -> Board column header gap — spacing *(adjusted by verifier)*
- **Design:** Column header row gap: 7px between label and count chip — `12-todos.jsx:617`
- **Code:** `gap-2` = 4px — `packages/ui/src/features/tasks/TaskColumn.tsx:66`
- **Verifier correction:** Drift is real but the mechanism is misdescribed. In TaskColumn.tsx:66-70 the count chip carries `ml-auto`, so it is pushed flush to the RIGHT edge of the header, not 4px from the label — gap-2 (4px) never governs the label↔chip distance. The design (12-todos.jsx:617) places the chip adjacent to the label at gap 7px with the spacer implicit. So the actual drift is 'chip right-aligned vs adjacent-at-7px', a larger layout difference than the claimed 7px→4px gap shrink.

### 9.16 `LOW` Right Inspector -> Tasks -> Quick Task dialog priority pills — extra-element
- **Design:** QuickTaskDialog priority pills are only ['low', 'medium', 'high'] — Critical is intentionally excluded from the fast-capture path — `12-todos.jsx:793`
- **Code:** QuickTaskDialog renders 4 pills including 'critical' (`(['low', 'medium', 'high', 'critical'] as const)`), letting the quick-add path create Critical-priority tasks the design never exposes there — `packages/ui/src/features/tasks/QuickTaskDialog.tsx:264`

### 9.17 `LOW` Right Inspector -> Tasks -> Edit modal Dependencies field — extra-element
- **Design:** TdEditModal has no dependency editor at all — the modal's fields are Title, Type/Priority/Status, Description, Attachments, Labels, Assignees, Milestone only. Dependencies are shown read-only on cards/rows but not editable in the modal. — `12-todos.jsx:400-441 (TdEditModal body — no dependencies field)`
- **Code:** TaskEditModal (via TaskMetaFields) adds a full DependencyPicker (searchable add/remove UI) not present in the design's modal — an invented feature beyond the artboard's scope — `packages/ui/src/features/tasks/TaskMetaFields.tsx:75-80; packages/ui/src/features/tasks/DependencyPicker.tsx:1-152`

### 9.18 `LOW` Right Inspector -> Tasks list view -> sort menu icon in list group header — icon *(adjusted by verifier)*
- **Design:** List/Board segmented view icons: 'doc.text' (document glyph) for List, 'square.grid.2x2' for Board — `12-todos.jsx:637`
- **Code:** TasksBoard uses lucide `LayoutList`/`LayoutGrid` — reasonable modern equivalents conveying the same list/grid meaning, but not a literal match to the prototype's document-icon-for-List choice — `packages/ui/src/features/tasks/TasksBoard.tsx:14, 93, 108`
- **Verifier correction:** The icon drift itself is accurate (design TdSegmented uses 'doc.text' for List and 'square.grid.2x2' for Board at 12-todos.jsx:637; code uses lucide LayoutList/LayoutGrid at TasksBoard.tsx:93/108), but the finding's path is mislabeled: this is the List/Board segmented view switcher in the Tasks board modal header, not a 'sort menu icon in list group header'. Severity low stands.

<details><summary>Coverage notes</summary>

Read design ground truth in full: 12-todos.jsx (TdCard/TdListRow/TdListView/TdBoardView/TdFilterBar/TdEditModal/QuickTaskDialog/TdSegmented/TdSortMenu/TD_TYPE/TD_PRI palettes), 04-engine.jsx Inspector/TasksList (bottom drawer, lines 1-234), prompt-sidebar-panel-headers.md §2 (drawer header spec, authoritative), and artboards/Tasks Review.html (canvas wiring, confirms which components are canonical). Compared against every file in packages/ui/src/features/tasks/ (TasksDrawer, TasksDrawerList, TaskListRow, TaskListView, TaskBoardView, TasksBoard, TaskCard, TaskColumn, TasksFilterBar, FilterMenu, SortMenu, TaskEditModal, QuickTaskDialog, TaskMetaFields, TaskSelectFields, DependencyPicker, TaskAttachments, task-palettes.ts, todos-filters.ts, use-todos-store.ts, TasksModalHost.tsx) plus InspectorPane.tsx composition and globals.css token definitions (verified every mf-* class resolves; verified compressed spacing/radius scale for every px comparison). Not checked: ChangesPanel.tsx (out of scope — Files/Changes tab, not Tasks), live-rendered pixel screenshots (compared source only per project convention), LabelAutocomplete.tsx internals (skimmed only, no material deltas spotted), backend/API contract for todos.ts.

</details>

<a id="area-10"></a>
## 10. Popovers — branch switcher, worktrees, tags, context menus

### 10.1 `HIGH` Branch popover -> Conflict view panel (Merge/Rebase halt state) — layout
- **Design:** ConflictsPopover uses `PopCard ... pad={0}` specifically so the red danger header bleeds edge-to-edge under the card's rounded top corners (13-popover.jsx:557 `popHost({..., width: 292, pad: 0, ...})`, header at :530-536 `padding:'10px 12px', background: T.red+'14'`).
- **Code:** ConflictView is rendered inside the shared `PANEL_CARD` constant which is hardcoded `p-[5px]` for every view (list/new-branch/rename/conflict alike) — the red header never bleeds to the edges; it sits inset by a 5px white gutter, and ConflictView's own `rounded-t-lg` (11px) on its header div is now meaningless/wrong given the 5px surrounding padding. — `packages/ui/src/features/git/BranchPopover.tsx:36 (PANEL_CARD), :283-284; packages/ui/src/features/git/ConflictView.tsx:30 (rounded-t-lg bg-mf-destructive-tint px-3 py-2)`

### 10.2 `HIGH` Popovers (global) -> MenuRow / ContextMenuItem / DropdownMenuItem icon default color — color
- **Design:** PopMenuRow's icon default color is `T.text3` (`iconColor || T.text3`, 13-popover.jsx:128) — the muted tertiary text color (`--mf-text-3`, e.g. `#92918d` light). Design's `T.text2` (mapped to shadcn `--muted-foreground`) is a visually darker, more prominent secondary-text color used for row LABELS' companion text, not for menu-row icons.
- **Code:** The shared `menuItemVariants` CVA (used by every MenuRow/ContextMenuItem/DropdownMenuItem in the app, including all Branch submenu rows, Tag rows, Session/Project context menu rows) defaults unstyled icons to `text-muted-foreground` (`--muted-foreground: #5e5d5a` light) instead of `--mf-text-3` (`#92918d`). This is a systemic, app-wide token substitution making every default-colored menu-row icon noticeably darker/more prominent than the design. — `packages/ui/src/components/ui/menu-variants.ts:18 ("[&_svg:not([class*='text-'])]:text-muted-foreground")`

### 10.3 `MEDIUM` Branch popover -> Branch row -> current-branch background — state
- **Design:** BranchRow's background is driven ONLY by `selected` (submenu-open state) → `T.rowHover`; a merely-current (checked-out) branch that is not selected has `background: 'transparent'` (13-popover.jsx:281-298).
- **Code:** BranchRow applies a permanent `bg-accent` tint whenever `isCurrent` is true, even when not selected: `selected ? 'bg-mf-selection' : isCurrent ? 'bg-accent hover:bg-accent' : 'hover:bg-accent'`. The current branch row is always visibly tinted in production; in the design it looks identical to any other unselected row (only the checkmark + green dot distinguish it). — `packages/ui/src/features/git/BranchRow.tsx:58-62`

### 10.4 `MEDIUM` Branch popover -> Branch row -> selected (submenu-open) background — color
- **Design:** `selected` state uses `T.rowHover` = `rgba(0,0,0,0.04)` — the same neutral hover tint as any other row (13-popover.jsx:285). No accent/brand color is used to mark the row whose submenu is open.
- **Code:** Selected branch row uses `bg-mf-selection`, a distinct accent-blue token (`--mf-selection: rgba(10,132,255,0.10)` light / `rgba(138,112,245,0.30)` dark) — visibly blue/purple-tinted instead of the neutral grey hover the design specifies. `--accent` in globals.css (`rgba(0,0,0,0.04)`) is the correct 1:1 match for `T.rowHover` and is unused here. — `packages/ui/src/features/git/BranchRow.tsx:61; packages/ui/src/styles/globals.css:40 (--accent), :57 (--mf-selection)`

### 10.5 `MEDIUM` Branch popover -> per-branch submenu -> action icons (Checkout/Pull/Push/Merge/Rebase/New branch from) — icon
- **Design:** BranchSubmenu items map: `New branch from '…'…` → icon `branch` (git-branch glyph, 01-base.jsx:471, lucide `GitBranch`); `Pull` → icon `arrow.down` (plain down arrow, lucide `ArrowDown`); `Push` → icon `arrow.up` (plain up arrow, lucide `ArrowUp`); `Merge into current` → icon `arrow.down`; `Rebase current onto this` → icon `arrow.up` (13-popover.jsx:304-326).
- **Code:** BranchSubmenu.tsx uses: New Branch from → `<Plus />` (wrong glyph — should be GitBranch); Pull → `<Download />` (a literal download-tray icon, not the design's plain up/down arrow); Push → `<Upload />`; Merge into Current Branch → `<GitMerge />`; Rebase Current onto This → `<GitPullRequest />`. None of Merge/Rebase/Pull/Push use the design's plain `ArrowUp`/`ArrowDown` glyphs — all four use unrelated, more decorative lucide icons, and 'New Branch from' uses a generic Plus instead of the branch glyph. — `packages/ui/src/features/git/BranchSubmenu.tsx:82-206 (buildItems)`

### 10.6 `MEDIUM` Branch popover -> per-branch submenu / list -> icon color (Globe/GitBranch header icon, divergence icon) — color
- **Design:** Submenu header icon color `T.text3` (13-popover.jsx:330); BranchDivergence wrapper text color `T.text3` (13-popover.jsx:447).
- **Code:** BranchSubmenu header icon uses `text-muted-foreground` (text2) (BranchSubmenu.tsx:225,227); BranchRow's BranchDivergence wrapper also uses `text-muted-foreground` (BranchRow.tsx:25). Same systemic text3→text2 substitution as the MenuRow icon default finding above, appearing again here as hand-authored classes (not just the shared primitive). — `packages/ui/src/features/git/BranchSubmenu.tsx:225,227; packages/ui/src/features/git/BranchRow.tsx:25`

### 10.7 `MEDIUM` Branch popover -> group section headers (Local branches / Remote / worktree name) — spacing
- **Design:** BranchSectionHead: fixed `height: 26`, inner `gap: 5` between chevron/icon/label (13-popover.jsx:264-277).
- **Code:** BranchGroupSection / WorktreeSection header buttons use `gap-1 px-2 py-1` — gap-1 = 2px (compressed scale) vs design's 5px, and `py-1` (2px top+bottom) yields a substantially shorter row than the design's fixed 26px (no explicit height set at all). — `packages/ui/src/features/git/BranchGroupSection.tsx:76; packages/ui/src/features/git/WorktreeSection.tsx:42`

### 10.8 `MEDIUM` Tag popover -> search field padding — spacing
- **Design:** PopSearchField: `padding: '0 9px'` (13-popover.jsx:105-106).
- **Code:** Shared `MenuSearchField` (used by TagPopover, not by BranchListView which built its own correct inline version) uses `px-2` = 4px (compressed scale), not the 9px the design specifies — noticeably tighter horizontal inset around the search icon/input. — `packages/ui/src/components/ui/menu.tsx:77; packages/ui/src/features/sessions/tags/TagPopover.tsx:188 (consumer)`

### 10.9 `LOW` Branch popover -> per-branch submenu -> header (branch name banner) — extra-element
- **Design:** BranchSubmenu header is just an icon + branch name with a bottom hairline (13-popover.jsx:329-333) — no back/close control; the submenu is dismissed by clicking a menu item (`onClick={() => onClose && onClose()}`) or by re-clicking the already-selected row in the list.
- **Code:** BranchSubmenu.tsx renders an explicit `ArrowLeft` "Back to branch list" icon button as the first element of the header, not present in the design. — `packages/ui/src/features/git/BranchSubmenu.tsx:214-223 (git-submenu-back button)`

### 10.10 `LOW` Branch popover -> branch row -> ahead/behind divergence text size — typography
- **Design:** BranchDivergence text `fontSize: 10` for both the populated state and the 'up to date' state (13-popover.jsx:445,447).
- **Code:** BranchRow's BranchDivergence uses `text-caption` (11px) for both states — `text-caption text-mf-text-4` (up to date) and `text-caption text-muted-foreground` (ahead/behind wrapper) instead of `text-micro` (10px). — `packages/ui/src/features/git/BranchRow.tsx:22,25`

### 10.11 `LOW` Tag popover -> tag row swatch dot size — spacing
- **Design:** PopCheckRow swatch: `width: 8, height: 8` circular dot (13-popover.jsx:177).
- **Code:** TagPopover's swatch span uses `size-1.5` = 6px (fractional Tailwind step, standard scale) instead of the design's 8px — swatch dot renders visibly smaller. — `packages/ui/src/features/sessions/tags/TagPopover.tsx:250-254`

### 10.12 `LOW` Popovers (global) -> MenuRow hint/note typography — typography
- **Design:** PopMenuRow `hint`: `fontFamily: MONO, fontSize: 10, color: T.text4` (13-popover.jsx:135); `note`: `fontSize: 10, color: T.text3` (13-popover.jsx:133).
- **Code:** MenuRow's hint span is `text-caption text-mf-text-4` (11px, sans-serif — no `font-mono` applied) and note span is `text-caption text-mf-text-3` (11px) — both one size larger than the design, and the hint is missing the monospace treatment the design uses for keyboard-shortcut style hints (e.g. `⌘1`, `⤓`, `↵`). — `packages/ui/src/components/ui/menu.tsx:60-61 (hint/note spans in MenuRow)`

### 10.13 `LOW` Branch popover -> Local branches -> prefix sub-grouping (e.g. `feat/`, `fix/` groups) — extra-element *(adjusted by verifier)*
- **Design:** BranchPopover's Local-branches list is flat — every local branch (not in a worktree) renders as a single ungrouped BranchRow list under one 'Local branches' header; there is no further grouping by name prefix (13-popover.jsx:385-392, BRANCH_SEED has flat names like `test/all-prs-merged`, `fix/composer-lock` rendered without sub-headers).
- **Code:** BranchGroupSection introduces an additional `PrefixGroup` layer that clusters local branches sharing a `prefix/` into their own collapsible sub-header (with its own chevron toggle and 12px left-indent), not present anywhere in the design or component-map. — `packages/ui/src/features/git/BranchGroupSection.tsx:20-58 (PrefixGroup)`
- **Verifier correction:** The extra PrefixGroup sub-grouping layer is real (design 13-popover.jsx:385-392 renders locals flat, and component-map.md line 59 lists only Local/worktree/Remote sections), but the cited '12px left-indent' is wrong: PrefixGroup indents rows with pl-3 (BranchGroupSection.tsx:46), which is 6px on this app's compressed integer Tailwind scale, not 12px. The chevron-toggle sub-header detail is accurate.

### 10.14 `LOW` Selection rows (shared MenuSelectRow primitive) — layout
- **Design:** PopSelectRow: leading checkmark gutter (`width:14`) appears FIRST, before the optional status dot and label; trailing `meta` last (13-popover.jsx:142-161).
- **Code:** MenuSelectRow renders `dot`, then `label`, then `meta`, and only THEN the `Check` icon trailing at the end of the row — checkmark position is reversed (trailing instead of leading gutter). Not exercised by Branch/Tag popovers directly in this pass, but is a shared primitive defined in the reviewed `menu.tsx` and used elsewhere for single-select popovers (e.g. sort menu). — `packages/ui/src/components/ui/menu.tsx:141-150 (MenuSelectRow)`

<details><summary>Coverage notes</summary>

Read 13-popover.jsx (full, all primitives + BranchPopover/NewBranchPopover/ConflictsPopover/TagPopover/ContextMenu) and Popovers Review.html (all artboards) as ground truth, plus mainframe-theme.css token values and component-map.md §"Popover system"/"Branch switcher" mapping rows. Compared against packages/ui/src/features/git/* (BranchPopover, BranchListView, BranchList, BranchGroupSection, BranchRow, BranchSubmenu, WorktreeSection, NewBranchDialog, RenameBranchView, ConflictView, GitConfirmDialog), packages/ui/src/features/sessions/tags/* (TagPopover, TagRecolorPanel, TagRegistryItemMenu, TagDeleteConfirm, tag-colors.ts), packages/ui/src/features/sessions/sidebar/SessionContextMenu.tsx + ProjectPillContextMenu.tsx, and components/ui/{popover,menu,menu-variants,dropdown-menu,context-menu}.tsx, cross-checked against packages/ui/src/styles/globals.css for real token values (spacing/radius/type-scale/colors) in both light-mode design and app-tauri palettes. Verified Tailwind v4 (color-mix, so `/opacity` modifiers on CSS vars are NOT a trap here per the project's own convention). Not checked: ConflictsPopover's exact rendering live in a browser (compared structurally/statically only); dark/other theme palettes beyond spot-checking a couple of `--mf-text-3`/`--muted-foreground`/`--mf-selection` values; WorktreePopover (composer) and SessionSortMenu, which use the same `MenuSelectRow` primitive but are out of this area's file list.

</details>

<a id="area-11"></a>
## 11. Viewers + editor chrome + Review Changes panel

### 11.1 `HIGH` ViewerShell -> 'Reveal in file tree' button size — spacing
- **Design:** width: 22, height: 20 — `15-viewers.jsx:38-41`
- **Code:** className="... h-5 w-[22px] ..." — `packages/ui/src/features/viewers/ViewerShell.tsx:69`
- **Note:** h-5 resolves to 12px under the compressed spacing scale (--spacing-5: 12px), not 20px. Width correctly uses arbitrary w-[22px]; height does not. Fix: h-[20px].

### 11.2 `HIGH` ImageViewer -> Zoom in / Zoom out header buttons size — spacing
- **Design:** VBtn: width: 22, height: 20 — `15-viewers.jsx:85-97, 232-233`
- **Code:** className="... h-5 w-[22px] ..." — `packages/ui/src/features/viewers/ImageViewer.tsx:103,114`
- **Note:** Same h-5→12px bug as ViewerShell's reveal button; both zoom buttons render 8px shorter than the design's 20px.

### 11.3 `HIGH` Review Changes -> Diff body anatomy (hunk header + gutters + sign column) — layout
- **Design:** Unified single-pane diff: sticky mono 11px hunk header ('@@ ... @@') on an accent@0c tint background; per-line dual gutter (old-line# / new-line#, 38px each), a 16px sign column (+/−), then tokenized code — `07-review.jsx:133-157 (RvHunk)`
- **Code:** ReviewDiffView renders CmDiffEditor — a CodeMirror @codemirror/merge MergeView, i.e. two side-by-side panes with CM's own built-in gutters/decorations; no textual '@@ ... @@' hunk header, no dedicated sign column, no accent-tinted hunk header bar — `packages/ui/src/features/review/ReviewDiffView.tsx:93-108; packages/ui/src/features/editor/CmDiffEditor.tsx:146-163`
- **Note:** component-map.md §3 explicitly permits 'assistant-ui Diff Viewer (standalone) or Monaco diff' as an alternate to the mocked unified-hunk layout, so this is a sanctioned substitution rather than an oversight — but the resulting visual anatomy (side-by-side panes, no hunk headers, no sign column) is fundamentally different from what the artboard shows and should be called out as a real, visible parity gap.

### 11.4 `MEDIUM` ViewerShell -> Header breadcrumb bar background — color
- **Design:** background: T.tabBar (#f3f0ea) for the 24px breadcrumb header, matching the footer — `15-viewers.jsx:23-27`
- **Code:** bg-[var(--mf-code-bg)] (#fbfaf7) on the header row; only the footer correctly uses bg-mf-tab-bar — `packages/ui/src/features/viewers/ViewerShell.tsx:48,82`
- **Note:** T.tabBar and T.codeBg are distinct tokens in mainframe-theme.css (#f3f0ea vs #fbfaf7); header and footer should share the same tabBar background per the design, but the header renders a lighter code-surface tint instead.

### 11.5 `MEDIUM` ImageViewer -> Zoom in / Zoom out button radius — radius
- **Design:** VBtn borderRadius: 6 — `15-viewers.jsx:88`
- **Code:** className="... rounded-md ..." — `packages/ui/src/features/viewers/ImageViewer.tsx:103,114`
- **Note:** rounded-md = 8px (--radius-md), not the design's 6px. Should be rounded-sm (--radius-sm: 6px), matching the local SEG_BTN two lines above which gets this right.

### 11.6 `MEDIUM` CsvViewer -> Filter chip (header actions) size + radius — spacing
- **Design:** height: 20, borderRadius: 6, padding '0 8px' — `15-viewers.jsx:164`
- **Code:** className="inline-flex h-5 items-center gap-1 rounded-md bg-mf-chip px-[8px]" — `packages/ui/src/features/viewers/CsvViewer.tsx:99`
- **Note:** h-5 = 12px (not 20px) and rounded-md = 8px (not the design's 6px). Two compounding drifts on the same element; fix: h-[20px] rounded-sm.

### 11.7 `MEDIUM` Viewers -> Shared Segmented component (dead code / duplicated control) — extra-element
- **Design:** One VSeg implementation reused by all Preview/Source, Fit/100% toggles — `15-viewers.jsx:63-82`
- **Code:** features/viewers/Segmented.tsx exists (with its own inner-radius bug: rounded-md instead of rounded-sm) but is never imported anywhere; ImageViewer.tsx, SvgViewer.tsx and MarkdownEditorTab.tsx each hand-roll their own local SEG_BTN/SEG_ACTIVE/SEG_IDLE constants instead — `packages/ui/src/features/viewers/Segmented.tsx:1-56 (unused); duplicated in ImageViewer.tsx:46-48, SvgViewer.tsx:46-48, MarkdownEditorTab.tsx:27-29`
- **Note:** Three near-identical, inconsistent copies of the same control exist instead of one canonical implementation — an incomplete refactor. The unused shared component's own docstring says it 'replaces the divergent per-viewer SEG_BTN constants', but nothing was migrated to use it, and it still has its own radius bug.

### 11.8 `MEDIUM` PdfViewer -> Page navigation, Fit/Width toggle, page indicator — missing-element
- **Design:** Header actions: ◀ Previous page / page N of M indicator / Next page ▶ / Fit⇄Width segmented toggle; status row shows 'PDF · N pages' and 'size · page N' — `15-viewers.jsx:296-334; Viewers Review.html:85 ('◀ page ▶ navigation, Fit ⇄ Width, page indicator in the status row')`
- **Code:** PdfViewer renders only an 'Open externally' text button in the actions slot and delegates all pagination/zoom to the native <embed> PDF plugin; no page-nav buttons, no Fit/Width toggle, no page-count status — `packages/ui/src/features/viewers/PdfViewer.tsx:83-109`
- **Note:** Architecturally defensible (native embed renders a real multi-page PDF instead of the mock), but it means the artboard's explicit chrome/state inventory for this viewer (page nav, Fit/Width, page indicator) is entirely absent from our own UI chrome — worth a product decision, not just an oversight.

### 11.9 `MEDIUM` Review Changes -> Commit rail suggestion chips — behavior
- **Design:** 3 chips, each a complete, diff-specific commit message ('feat: collapsible rail', 'refactor: zone tabs', 'chore: drop legacy dock') that fills the whole textarea on click — `07-review.jsx:298`
- **Code:** SUGGESTIONS = ['feat: ', 'fix: ', 'refactor: ', 'chore: ', 'docs: '] — 5 generic conventional-commit prefixes, not full contextual messages — `packages/ui/src/features/review/ReviewCommitRail.tsx:12`
- **Note:** Changes the interaction from 'one-click complete suggested message' to 'insert a prefix and keep typing'. Also chip count differs (3 vs 5) and the chips no longer reflect the actual changed files, since they are static generic prefixes rather than derived from the diff.

### 11.10 `LOW` MarkdownEditorTab -> Preview/Source segmented toggle, inner button radius — radius
- **Design:** VSeg inner button borderRadius: 6 (outer track stays 8) — `15-viewers.jsx:65-77`
- **Code:** const SEG_BTN = 'h-[18px] rounded-md px-[8px] ...' — `packages/ui/src/features/editor/MarkdownEditorTab.tsx:29`
- **Note:** Inner active/idle segment buttons use rounded-md (8px) instead of the design's 6px inner radius. SvgViewer/ImageViewer's own local SEG_BTN get this right (rounded-sm); this copy diverges.

### 11.11 `LOW` CsvViewer -> Zebra row background (odd rows) — color
- **Design:** ri % 2 ? T.content (#ffffff) : '#fbfaf7' (hardcoded, equals T.codeBg) — `15-viewers.jsx:199`
- **Code:** className={rowIdx % 2 === 0 ? 'bg-background' : 'bg-card'} — `packages/ui/src/features/viewers/CsvViewer.tsx:156`
- **Note:** bg-card resolves to --card (#f8f6f2), not the design's #fbfaf7 tint. Visually very close but not the same token/value; consider bg-mf-code-bg instead of bg-card for the alternating stripe.

### 11.12 `LOW` CsvViewer -> Column header sort indicator — icon
- **Design:** When a column is actively sorted, renders Icon name="chevron.up.down" (9px) in addition to the ▲/▼ text glyph — `15-viewers.jsx:187-191`
- **Code:** Only the ▲/▼ text span is rendered; no chevron/ChevronsUpDown icon — `packages/ui/src/features/viewers/CsvViewer.tsx:146-147`
- **Note:** Missing decorative chevron glyph next to the sort arrow. Low visual impact since the triangle already communicates direction.

### 11.13 `LOW` Review Changes -> Inline comment-to-agent form under the diff — extra-element
- **Design:** No comment/annotation form beneath the diff hunks — the design's diff pane is read-only display plus the file toolbar (Open in workspace / Viewed) only — `07-review.jsx:243-277 (Diff viewer column: only file toolbar + hunks, no comment form)`
- **Code:** ReviewDiffView appends a bordered comment form (line-select summary, textarea, Comment submit button) below the diff — `packages/ui/src/features/review/ReviewDiffView.tsx:112-143`
- **Note:** A real functional addition beyond the artboard's scope (posts a formatted line-comment message into the chat). Not necessarily wrong, but it's UI chrome the design never specifies, so calling it out per the audit's 'sweep for chrome that does not exist in the design' instruction.

### 11.14 `LOW` Review Changes -> File row active-selection tint / status badge tint alpha — color *(adjusted by verifier)*
- **Design:** Active row bg: `${ACCENT}16` (~8.6% alpha); status badge bg: `${statusColor}1f` (~12.2% alpha); Viewed-chip border: `${T.green}55` (~33% alpha), bg `${T.green}16` (~8.6% alpha) — `07-review.jsx:228-231, 263-264`
- **Code:** Active row: bg-mf-selection (10% alpha via --mf-selection token); status badge: bg-*/15 (15% alpha); Viewed-chip: border-mf-success/40 (40% alpha), bg-mf-success/10 (10% alpha) — `packages/ui/src/features/review/ReviewFileTree.tsx:14-18,70; packages/ui/src/features/review/ReviewFileToolbar.tsx:55`
- **Note:** All values are close (within a few alpha points) and use real semantic tokens rather than hardcoded hex, which is generally the correct direction — flagging only because the alpha values are measurably different from the artboard's exact hex+alpha values, most noticeably the Viewed-chip border (33% design vs 40% code).
- **Verifier correction:** The active-row selection tint is NOT a drift: the code's bg-mf-selection resolves to rgba(10,132,255,0.10) (globals.css:57), which exactly matches the design system's own --mf-selection token (design mainframe-theme.css:89) — the artboard's `${ACCENT}16` (~8.6%) hardcode is the outlier, and the code correctly uses the canonical token. The remaining alpha diffs are real but minor: status badge 12.2% (`${st.c}1f`, 07-review.jsx:231) vs 15% (bg-*/15, ReviewFileTree.tsx:14-18), Viewed-chip border 33% (`${T.green}55`, 07-review.jsx:263) vs 40% (border-mf-success/40, ReviewFileToolbar.tsx:55), Viewed-chip bg 8.6% vs 10%. Severity stays low.

### 11.15 `LOW` Review Changes modal -> Overall size cap — layout
- **Design:** width: 88%, height: 86%, maxWidth: 1180, maxHeight: 880 — `07-review.jsx:186`
- **Code:** className="flex h-[86vh] w-full max-w-[1180px] flex-col ..." — no max-height cap at all — `packages/ui/src/features/review/ReviewPanel.tsx:113`
- **Note:** On tall viewports (>1023px tall) the modal can grow past the design's intended 880px cap since there is no max-h-[880px] equivalent.

<details><summary>Coverage notes</summary>

Read both design source files in full (15-viewers.jsx, 07-review.jsx) plus the Viewers Review.html artboard/canvas and the relevant component-map.md rows (§3 Editor & viewers). Cross-checked every color/spacing/radius token against packages/ui/src/styles/globals.css and mainframe-theme.css to resolve exact px/alpha values under the compressed spacing scale before flagging anything. Compared, file by file: ViewerShell, Segmented, CsvViewer, ImageViewer, SvgViewer, PdfViewer, UnsupportedViewer, viewer-router, viewer-status against 15-viewers.jsx; ReviewPanel, ReviewPanelHeader, ReviewFileTree, ReviewFileToolbar, ReviewDiffPane, ReviewDiffView, ReviewCommitRail, git-status-to-files against 07-review.jsx. Verified icon choices against the actual SVG path definitions in 01-base.jsx (locate=Crosshair, pop=ExternalLink, diff=GitCompare, branch=GitBranch, magnifyingglass=Search, plus/minus.magnifyingglass=ZoomIn/ZoomOut, arrow.up.left.down.right=Maximize2, doc=File, chevron.up.down=ChevronsUpDown) rather than assuming names. Confirmed several things match well and were NOT flagged: ViewerShell breadcrumb spacing/padding (pl-5/pr-1.5), status footer, Segmented outer-track sizing, MarkdownPreview padding/max-width, CsvViewer numeric alignment/sticky header/status strings, ReviewPanelHeader icon/gap/token choices, ReviewFileToolbar layout, ReviewCommitRail structure/states (committed success state, unviewed warning, disabled Commit). DiffHeader/DiffTab/EditorTab were inspected but are chiefly driven by 03-content.jsx (not supplied as ground truth for this area), so I did not raise findings against them beyond confirming they reuse ViewerShell correctly and do not repeat the h-5 bug. Could not do a live pixel-diff render (no running dev server was started) — all findings are from static source comparison against the exact px/hex values in the jsx prototypes and resolved token values in globals.css.

</details>

<a id="area-12"></a>
## 12. Window states — toasts, connection overlay, tutorial, error state

### 12.1 `MEDIUM` Connection Overlay -> Backdrop scrim — color
- **Design:** background: 'rgba(233,231,226,0.62)' — a bespoke lower-opacity warm scrim distinct from the chrome-glass token — `14-windowstates.jsx:145`
- **Code:** background: 'var(--mf-glass)' → rgba(240,237,231,0.84) — the titlebar/sidebar chrome-glass token, wrong alpha (0.84 vs 0.62) and slightly different hue — `packages/ui/src/app/ConnectionOverlay.tsx:40`
- **Note:** T.glass is documented in 01-base.jsx as 'frosted chrome — titlebar + sidebar', not a modal/overlay scrim; the design intentionally used a different, lighter value here. No matching mf-* token exists in globals.css for this exact rgba — would need an arbitrary value or a new token, not a reuse of --mf-glass.

### 12.2 `MEDIUM` First-run tour -> Label card -> 'Step N of N' eyebrow — color
- **Design:** color: T.text3 (light #92918d) — a lighter tertiary tone, distinct from body text2 — `14-windowstates.jsx:203`
- **Code:** text-muted-foreground → var(--muted-foreground) = #5e5d5a, which is T.text2, not T.text3 — `packages/ui/src/features/tour/WsTourLabel.tsx:44-45`
- **Note:** globals.css defines a real --mf-text-3 token (text-mf-text-3 utility exists, confirmed via --color-mf-text-4 pattern at line ~690 and the analogous --mf-text-3 vars at lines 54/189/300/392/492); every OTHER secondary-text usage in this module correctly maps to text2/muted-foreground, so this is an isolated darker-than-intended eyebrow label. Fix: swap to text-mf-text-3.

### 12.3 `MEDIUM` First-run tour -> Label card -> inactive step dots — color
- **Design:** background: i === idx ? ACCENT : T.text4 (light #bcbab5 — a warm mid-gray) — `14-windowstates.jsx:210`
- **Code:** background: i === idx ? 'var(--primary)' : 'var(--border)' → var(--border) = rgba(0,0,0,0.08), a near-invisible hairline alpha instead of the design's solid warm-gray dot — `packages/ui/src/features/tour/WsTourLabel.tsx:74`
- **Note:** globals.css defines --mf-text-4 (and the utility --color-mf-text-4 at line 690, used correctly elsewhere e.g. ConnectionOverlay-adjacent scrollbar styles) — the inactive dots should use text-mf-text-4 equivalent (bg-mf-text-4) instead of border, which will render much fainter than intended, especially in dark mode where --border is rgba(255,255,255,0.10).

### 12.4 `LOW` Connection Overlay -> Spinner ring (base track) vs Progress rail (track) — color
- **Design:** Both the spinner base ring and the progress-rail track use the SAME token, T.hairline (rgba(0,0,0,0.06) light) — `14-windowstates.jsx:155 (ring) and 14-windowstates.jsx:163 (rail)`
- **Code:** Ring uses var(--border) (rgba(0,0,0,0.08)); rail uses var(--mf-chip) (rgba(0,0,0,0.05)) — two different substitute tokens for what should be one consistent value, so the ring reads visibly heavier than the rail — `packages/ui/src/app/ConnectionOverlay.tsx:73 (ring), :97 (rail)`
- **Note:** There is no --mf-hairline token in globals.css, so neither substitute is exact, but picking two different tokens for one design token creates an internal inconsistency not present in the artboard.

### 12.5 `LOW` Toast card -> Dismiss button hover fill — color
- **Design:** onMouseEnter sets background: T.rowHover (light rgba(0,0,0,0.04) — a neutral black-tint wash) — `14-windowstates.jsx:96`
- **Code:** hover:bg-muted/60 → --muted (light #f3efe7, an opaque warm cream fill) blended at 60% opacity — a warm-tinted wash, not the neutral rowHover wash; diverges further in dark mode (--muted #313447 vs design's white-wash rgba(255,255,255,0.055)) — `packages/ui/src/components/ui/ws-toast.tsx:167`
- **Note:** globals.css defines --accent as the exact hover-surface equivalent of T.rowHover (documented inline as 'HOVER surface', values match T.rowHover exactly across all 5 theme blocks e.g. rgba(0,0,0,0.04) light / rgba(255,255,255,0.055) dark). Correct fix is hover:bg-accent, not hover:bg-muted/60.

### 12.6 `LOW` Toast card & Error state / Tour -> secondary ('ghost') buttons — typography
- **Design:** wsGhostBtn: fontWeight: 550 (Back button, Skip tour, Copy details, Reload) — `14-windowstates.jsx:222-225, 283`
- **Code:** font-medium (500) used for tour Back/Skip-tour buttons and ErrorState Copy/Reload buttons — `packages/ui/src/features/tour/WsTourLabel.tsx:85 (Back), packages/ui/src/features/tour/TutorialOverlay.tsx:173 (Skip), packages/ui/src/features/shared/ErrorState.tsx:79/93 (Copy/Reload)`
- **Note:** Systematic across all wsGhostBtn-derived buttons in this module; Tailwind has no discrete 550 utility so an arbitrary font-[550] would be needed to hit this exactly. One dedup finding covering 4 call sites.

### 12.7 `LOW` Toast card -> Title letter-spacing — typography
- **Design:** letterSpacing: -0.1 (bespoke value, not the LS.tight -0.02em rung) — `14-windowstates.jsx:83`
- **Code:** tracking-tight → --tracking-tight: -0.02em (≈ -0.26px at 13px, overshoots the design's -0.1px) — `packages/ui/src/components/ui/ws-toast.tsx:121`
- **Note:** Sub-pixel delta at 13px; using the closest system rung rather than an arbitrary tracking-[-0.1px].

### 12.8 `LOW` Toast card -> Description line-height — typography
- **Design:** lineHeight: 1.45 for the toast description specifically (every other body block in this module — connection subtitle, tour body, error body — uses 1.5) — `14-windowstates.jsx:85 (cf. 161/206/377 which use 1.5)`
- **Code:** leading-normal → --leading-normal: 1.5, not the toast-specific 1.45 — `packages/ui/src/components/ui/ws-toast.tsx:123`
- **Note:** Isolated to the toast description; a very small (0.05) delta, would need leading-[1.45].

### 12.9 `LOW` Toaster -> Entrance animation curve — behavior
- **Design:** Post-mount RAF-driven opacity/transform slide-in using transition: 'opacity 0.24s ease, transform 0.24s cubic-bezier(0.22,1,0.36,1)' — the app's documented --ease-signature curve, explicitly called out in the area notes as part of toast anatomy — `14-windowstates.jsx:73-74; component-map/area-notes reference '--ease-signature'`
- **Code:** Entrance/exit relies entirely on sonner's own built-in CSS transition/animation (no ease-signature applied); --ease-signature is defined in globals.css but never referenced by any toast code — `packages/ui/src/components/ui/ws-toast.tsx (no transition on mount), packages/ui/src/lib/toast.ts:35-48, packages/ui/src/styles/globals.css:104`
- **Note:** Architecturally reasonable given toast.custom() delegates position/stacking/motion to sonner, and is called out in the component's own header comment as a deliberate simplification — but it means the app's signature slide-in curve is not actually used anywhere in the toast entrance, which the design explicitly specifies as an anatomy point.

<details><summary>Coverage notes</summary>

Read 14-windowstates.jsx and Window States.html completely (Toaster/WsToast/MfToaster, ConnectionOverlay, WsTourLabel/WsTourCore/TutorialOverlay, ErrorState/MfErrorBoundary/WsBoom) plus 01-base.jsx for the full T token table (all 6 theme variants), RADIUS/SPACE/FS/FW/LH/LS scales, and the Icon set. Cross-referenced component-map.md (§ toast/connection/tutorial mappings to Sonner/Alert/Popover) and mainframe-theme.css / packages/ui/src/styles/globals.css for every mf-* and shadcn token referenced by both the design and the built code (--mf-glass, --mf-chip, --mf-shadow-pop, --mf-shadow-modal, --mf-scrim, --mf-warning(-tint), --mf-success(-tint), --mf-destructive-tint, --mf-border-hover, --mf-text-3/4, --accent, --border, --muted(-foreground), --primary, --destructive, text-caption/label/body/heading/title scale, --tracking-tight, --leading-normal, --spacing-*, --radius-*, keyframes ws-toast-rail/ws-indeterminate/tw-spin/twPulse). Compared all 7 production files line-by-line against the design: ws-toast.tsx, sonner.tsx, lib/toast.ts (fire/success/error/warning/info + AUTO_DISMISS_MS=4200 + error=Infinity duration, matching design's WS_TOAST_MS and error-persists rule), app/ConnectionOverlay.tsx, features/tour/TutorialOverlay.tsx + WsTourLabel.tsx, store/tutorial.ts (state machine: 4 steps, Next/Back/Skip/Done — matches design's WS_TOUR_STEPS), features/shared/ErrorState.tsx + MfErrorBoundary.tsx, features/chat/messages/MessageRenderBoundary.tsx (confirmed out of scope for this design file — a defensive per-message boundary with no design equivalent, not a drift). Verified all 4 data-tut anchors (sessions/composer/model/run) exist in real chrome (SessionSidebar, Composer, ProviderModelSelect, SurfaceRail). Verified data-testid coverage on every interactive element in all 4 areas — complete. Did not run the live app / take screenshots (source-level comparison per the prototype README guidance); did not check the embedded/mock-workspace review-canvas rendering path since that is design-canvas-only tooling with no production equivalent expected. Confirmed the Tailwind v4 /opacity-modifier calibration rule applies here (color-mix works), so bg-primary/12 in WsTourLabel is NOT a phantom-token bug despite superficially matching that anti-pattern.

</details>

<a id="area-13"></a>
## 13. Daemon connection — footer status, picker, pairing dialogs

### 13.1 `MEDIUM` Footer Status -> Trigger button -> ConnDot / DaemonGlyph sizing — icon *(adjusted by verifier)*
- **Design:** Footer trigger uses ConnDot size={6} and DaemonGlyph size={11} (17-daemon.jsx:222-223), distinct from the picker row's ConnDot size={8}/DaemonGlyph size={15} (17-daemon.jsx:105,120) — the footer glyphs are deliberately smaller than the row glyphs. — `17-daemon.jsx:40-54 (ConnDot/DaemonGlyph default sizes), :105 (row ConnDot size 8/glyph 15), :222-223 (footer ConnDot size 6/glyph 11)`
- **Code:** ConnDot and DaemonGlyph take no size prop in production; both are hardcoded (solid dot bg via `size-2`=4px, spin ring `size-[10px]`, glyph `size={14}`) and reused identically in DaemonFooterStatus.tsx:131-132 and DaemonRow.tsx:214/233. The footer glyph renders at 14px (design wants 11px) and the footer dot effectively renders larger than intended relative to the 18px-tall trigger; the row's solid dot renders at 4px instead of design's 8px. — `packages/ui/src/features/daemon/DaemonRow.tsx:64-93 (ConnDot/DaemonGlyph fixed, no size prop); packages/ui/src/features/daemon/DaemonFooterStatus.tsx:131-132`
- **Verifier correction:** Core drift confirmed: ConnDot/DaemonGlyph take no size prop; glyph is fixed at 14px (design: footer 11 / row 15, 17-daemon.jsx:222-223,105) and the solid dot is fixed at size-2 = 4px (design: row 8 / footer 6). But the claim that the footer dot 'effectively renders larger than intended' is inverted — the code footer dot (4px) renders SMALLER than the design's 6px, not larger. All other values and refs check out (DaemonRow.tsx:64-93, DaemonFooterStatus.tsx:131-132).

### 13.2 `MEDIUM` Daemon Picker -> DaemonRow -> solid ConnDot diameter — spacing
- **Design:** Solid connection dot is 8px diameter (`width:size,height:size` with default `size=8`). — `17-daemon.jsx:46,53 (ConnDot size=8 default)`
- **Code:** `size-2` Tailwind utility resolves to `--spacing-2: 4px` in this app's compressed scale (globals.css:775) — the dot renders at 4px, half the design's 8px, and is not an arbitrary `[8px]` value. — `packages/ui/src/features/daemon/DaemonRow.tsx:84`

### 13.3 `MEDIUM` Daemon Picker -> DaemonRow -> row padding — spacing
- **Design:** Row padding `'7px 7px 7px 8px'` (7px vertical, 7/8px horizontal), gap 9px between elements, all sitting inside a PopCard with pad=5 uniform. — `17-daemon.jsx:95`
- **Code:** Row padding is `px-[6px] py-[4px]` (4px vertical — nearly half the design's 7px — and 6px horizontal, not the asymmetric 7/8), gap is `gap-[8px]` (design 9px). Net effect: rows render noticeably denser/tighter vertically than the artboard. — `packages/ui/src/features/daemon/DaemonRow.tsx:195`

### 13.4 `MEDIUM` Daemon Picker -> DaemonRow -> manage (⋯) button — state
- **Design:** Manage button is always visible (24×24, background transparent → chipBg/rowHover only on open/hover). No opacity-based reveal-on-row-hover. — `17-daemon.jsx:67-75 (button always rendered, 24×24, only background changes)`
- **Code:** Button is `size-[22px]` (design 24px) and starts at `opacity-0`, only becoming visible via `group-hover:opacity-100` or `data-[state=open]:opacity-100` — i.e. it is hidden by default and only appears when the row is hovered/focused. This is a real behavioral/visual divergence: users scanning the picker without hovering see no manage affordance at all on remote rows, whereas the artboard always shows it. — `packages/ui/src/features/daemon/DaemonRow.tsx:115-123`

### 13.5 `MEDIUM` Re-pair Prompt -> amber lock tile radius — radius
- **Design:** Lock tile is 46×46 with `borderRadius: RADIUS.lg` (11px) — a rounded square, not a circle (17-daemon.jsx:662). — `17-daemon.jsx:662`
- **Code:** `rounded-full` — renders as a full circle, not the design's rounded-square (radius-lg) tile. — `packages/ui/src/features/daemon/RepairPrompt.tsx:52`

### 13.6 `MEDIUM` Daemon Unreachable overlay -> indeterminate bar animation — behavior
- **Design:** Bar fill uses a dedicated `ws-indeterminate` keyframe sliding a 40%-width segment left-to-right across the 200px track (17-daemon.jsx:719). — `17-daemon.jsx:718-719`
- **Code:** Uses `animate-pulse` (opacity pulse) instead of a sliding/indeterminate translate animation — the static 40%-width segment just fades in/out in place rather than sweeping across the track, a visibly different motion/behavior for the loading affordance. — `packages/ui/src/features/daemon/DaemonUnreachableBody.tsx:64-66`

### 13.7 `LOW` Daemon Picker -> Header eyebrow row — spacing *(adjusted by verifier)*
- **Design:** Header padding `'4px 6px 6px'` (top 4, sides 6, bottom 6). — `17-daemon.jsx:140`
- **Code:** `px-[10px] pb-[6px] pt-[2px]` — horizontal padding is 10px (design 6px) and top padding is 2px (design 4px). — `packages/ui/src/features/daemon/DaemonPicker.tsx:113`
- **Verifier correction:** The element-level values are literally true, but the comparison ignores the design's PopCard pad={5} wrapper. Design effective inset from the card edge = 11px horizontal (5+6) and 9px top (5+4); code effective inset = 10px horizontal (root has no px, PopoverContent is p-0, header px-[10px]) and 7px top (root py-[5px] + pt-[2px]). Real drift is only ~1px horizontal and 2px top — not '10px vs 6px' — so this is a near-match, borderline noise at low severity.

### 13.8 `LOW` Daemon Picker -> DaemonRow -> 'Local' chip — typography
- **Design:** Local chip: `fontSize:9, fontWeight:700, textTransform:uppercase, letterSpacing:0.5, borderRadius:4, padding:'1px 5px'`, inherits the default UI font (FONT) — no monospace. — `17-daemon.jsx:111-114`
- **Code:** `rounded-sm bg-mf-chip px-[5px] py-px font-mono text-micro font-bold uppercase tracking-wide text-mf-text-3` — adds `font-mono` (design uses the default sans font, not mono, for this chip), uses `text-micro` = 10px (design 9px), and `rounded-sm` = 6px (design 4px, i.e. `rounded-xs`). — `packages/ui/src/features/daemon/DaemonRow.tsx:222-224`

### 13.9 `LOW` Daemon Picker -> Fallback banner icon (needs-repair vs unreachable) — icon
- **Design:** Banner icon is `lock` when re-pair needed, `wifi` (connected-wifi glyph, i.e. Wifi) when unreachable (17-daemon.jsx:153). — `17-daemon.jsx:153`
- **Code:** Uses `Lock` for needs-repair (correct) but `WifiOff` for unreachable, not `Wifi`. `wifi` in the design's icon set maps to a connected-signal glyph (used elsewhere for connectivity, not a slashed/disabled one); the artboard is showing 'is unreachable' messaging with a plain connectivity icon, not an explicit 'no signal' icon. This is a plausible-but-different glyph choice. — `packages/ui/src/features/daemon/DaemonPicker.tsx:11,53`

### 13.10 `LOW` Daemon Picker -> Footer 'Add remote daemon…' row — typography
- **Design:** Rendered via `PopMenuRow` (13-popover.jsx:118-139): label `fontSize:12, fontWeight:500`, icon in a fixed 16px-wide slot at `size:13`, row padding `'7px 8px'`, gap 9 — consistent with all other menu rows (rename/re-pair/remove) in the surface. — `17-daemon.jsx:180-181; 13-popover.jsx:118-139`
- **Code:** Rendered as a bespoke `<button>` (not the `MenuRow` primitive used elsewhere): `text-body` (13px, not 12px), icon `Plus size={14}` (not 13px) with no fixed-width slot so it doesn't column-align with rows above, `gap-[6px]` (design 9px), `px-[6px] py-[5px]` (design 7px/8px). Renders visibly bigger/looser than a standard menu row and breaks icon-column alignment with the picker rows above it. — `packages/ui/src/features/daemon/DaemonPicker.tsx:167-179`

### 13.11 `LOW` Add Remote Dialog -> Header icon tile — spacing
- **Design:** Header tile is 34×34 (`width:34,height:34`) with `Icon name="server" size={17}`. — `17-daemon.jsx:409-411`
- **Code:** Tile is `size-[36px]` with `Server size={18}` — both ~2px larger than the design spec. — `packages/ui/src/features/daemon/AddRemoteDialog.tsx:86-87`

### 13.12 `LOW` Add Remote Dialog -> Dialog title font size — typography
- **Design:** Dialog title `fontSize:14.5, fontWeight:700`. — `17-daemon.jsx:414`
- **Code:** `text-heading font-semibold` — `text-heading` resolves to 15px (globals.css:753) not 14.5px, and `font-semibold` (600) not 700. 14.5px isn't on the app's defined type-scale rungs (10/11/12/13/15/17/22/28) so 15 is the nearest rung, but the weight mismatch (700 vs 600) is a real, visible difference on a dialog title. — `packages/ui/src/features/daemon/AddRemoteDialog.tsx:90`

### 13.13 `LOW` Rename/Remove Dialog -> Icon chip size/radius — spacing
- **Design:** Icon chip is 36×36 with `borderRadius: RADIUS.md` (8px) and `Icon size={17}`. — `17-daemon.jsx:613-616`
- **Code:** `size-[38px]` with `rounded-lg` (11px, not 8px) and icon `size={18}`. — `packages/ui/src/features/daemon/DaemonSmallDialog.tsx:40-51`

### 13.14 `LOW` Rename/Remove Dialog -> title font size/weight — typography
- **Design:** Title `fontSize:15, fontWeight:700, letterSpacing:-0.2`. — `17-daemon.jsx:618`
- **Code:** `text-heading font-semibold` = 15px / 600 (design wants 700) with no explicit tracking-tight applied (design has `letterSpacing:-0.2`, the app's `--tracking-tight` is `-0.02em` ≈ -0.3px at 15px — close but not applied at all here since no tracking class is used). — `packages/ui/src/features/daemon/DaemonSmallDialog.tsx:87,134`

### 13.15 `LOW` Re-pair Prompt -> host/401 chip radius for the '401' badge — radius
- **Design:** 401 badge `borderRadius: 4` (17-daemon.jsx:676). — `17-daemon.jsx:676`
- **Code:** `rounded-sm` = 6px (globals.css:743), not 4px (`rounded-xs`). — `packages/ui/src/features/daemon/RepairPrompt.tsx:34-36`

### 13.16 `LOW` Daemon Unreachable overlay -> card padding/shadow — shadow
- **Design:** Card shadow is `'0 30px 80px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.06)'` (17-daemon.jsx:705), padding `'30px 38px 26px'`. — `17-daemon.jsx:703-705`
- **Code:** Uses `var(--mf-shadow-modal)` = `'0 24px 60px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.18)'` (globals.css:93) — a shared token with different blur/spread/opacity values than the artboard's bespoke shadow for this specific overlay. Padding `pt-[30px] px-[38px] pb-[26px]` matches design exactly. — `packages/ui/src/features/daemon/DaemonUnreachableBody.tsx:47-51`

### 13.17 `LOW` Add Remote Dialog -> Pairing code help text CLI snippet — text
- **Design:** Help text references `curl POST /api/auth/pair` (17-daemon.jsx:481). — `17-daemon.jsx:481`
- **Code:** Help text references `mainframe-daemon pair` — a different (and presumably actually-correct, CLI-based) command than the design's curl snippet. Flagging as a text delta since the artboard is the nominal ground truth, though this may be an intentional accuracy fix by the porter rather than a miss. — `packages/ui/src/features/daemon/pairing-steps.tsx:113-114`

### 13.18 `LOW` Add Remote Dialog -> Step rail connector width — spacing
- **Design:** Connector line between step 1 and step 2 is `width: 22, height: 1.5`. — `17-daemon.jsx:366`
- **Code:** Connector is `h-px w-8` — `w-8` in this app's compressed scale is `--spacing-8 = 24px` (globals.css:782), close to design's 22px (2px over) but not an arbitrary exact-match value; height is `h-px` = 1px, not 1.5px. — `packages/ui/src/features/daemon/pairing-shared.tsx:27`

### 13.19 `LOW` Add Remote Dialog -> DLG_LABEL letter-spacing — typography
- **Design:** Field labels (`Server URL`, `Pairing code`, `Device name`) use `letterSpacing: 0.1` (px) — a slight positive tracking (17-daemon.jsx:323). — `17-daemon.jsx:323`
- **Code:** Labels use `text-label font-semibold text-muted-foreground` with no tracking utility applied — default (0) tracking, not the design's slight positive letter-spacing. — `packages/ui/src/features/daemon/pairing-steps.tsx:28,109,127`

### 13.20 `LOW` Daemon Picker -> DaemonRowManage popover width — spacing
- **Design:** Manage popover `width={188}, pad={4}` (17-daemon.jsx:65). — `17-daemon.jsx:65`
- **Code:** `PopoverContent align="end" sideOffset={4} className="w-44"` — `w-44` is standard (unmodified) Tailwind width scale = 176px, not the design's 188px (12px narrower). — `packages/ui/src/features/daemon/DaemonRow.tsx:125`

<details><summary>Coverage notes</summary>

Read 17-daemon.jsx in full (753 lines: DaemonFooterStatus, DaemonPicker, DaemonRow/DaemonRowManage, ConnDot/DaemonGlyph, AddRemoteBody/AddRemoteDialog, PairCodeInput, StepRail, RenameRemoveBody/DaemonSmallDialog, RepairPromptBody, DaemonUnreachableBody, ModalScrim) plus 13-popover.jsx (PopCard/PopMenuRow/PopDivider) for popover-content contracts consumed by module 17. Compared against all production files in packages/ui/src/features/daemon/ (DaemonFooterStatus.tsx, DaemonPicker.tsx, DaemonRow.tsx, AddRemoteDialog.tsx, pairing-steps.tsx, pairing-shared.tsx, PairCodeInput.tsx, DaemonSmallDialog.tsx, RepairPrompt.tsx, DaemonUnreachableBody.tsx, use-daemon-registry.ts) and packages/ui/src/styles/globals.css (resolved every mf-* token, spacing/radius/text scale referenced) plus components/ui/popover.tsx and components/ui/menu.tsx for shared-primitive wrappers. All flagged classes were checked against globals.css @theme values, not assumed. Did not run/screenshot the live app (static source diff only, per prototype-README guidance); did not review active-daemon-context.tsx/pair-daemon.ts/reset-daemon-scoped-stores.ts in depth since they are non-visual state/network logic with no design counterpart to diff against.

</details>

<a id="area-14"></a>
## 14. Settings modal + command palette

### 14.1 `HIGH` Settings -> Providers pane -> Provider header (avatar + name + install status) — missing-element
- **Design:** Each provider pane opens with a header block: 30x30 colored rounded-8 avatar tile (provider initial), 17px/700 provider name, and an 11px status row with a colored dot + 'Detected on PATH' / 'Not installed' text — `05-settings.jsx:302-316 (StgProvider header block)`
- **Code:** ProvidersPane renders only a bare `<h3 className="text-heading font-medium">{adapter.name}</h3>` — no avatar tile, no installed/not-installed status row — `packages/ui/src/features/settings/panes/providers/ProvidersPane.tsx:33-38`
- **Note:** Visible at a glance — the provider identity/status header that anchors the whole Providers pane is entirely absent.

### 14.2 `HIGH` Command palette -> Commands mode -> per-command icon — icon
- **Design:** Each command has a distinct glyph: review->`diff`, settings->`gear`, sidebar->`sidebar.left`, inspector->`sidebar.right`, files->`folder`, run->`play.fill` — `06-palette.jsx:69-76 (COMMANDS array)`
- **Code:** Every row of type `command` renders the same single icon, `ChevronRightIcon`, regardless of command id — `packages/ui/src/features/palette/SpotlightRow.tsx:12-18 (ICONS map: `command: ChevronRightIcon`)`
- **Note:** Visible at a glance in the '>' command mode — all 6 commands (Review changes, Open Settings, Toggle Sidebar, Toggle Inspector, Reveal Files, Reveal Run) look identical instead of being individually recognizable by icon. Fix: map palette-commands.ts ids to distinct lucide icons (GitCompare/Diff for review, Settings for settings, PanelLeft for sidebar, PanelRight for inspector, Folder for files, Play(fill) for run) and thread an `icon` field through PaletteCommand + commandRows().

### 14.3 `MEDIUM` Settings modal + Command palette -> Chrome hairlines (header/sidebar/field/footer borders) — border
- **Design:** 0.5px hairline borders throughout: modal header `borderBottom: 0.5px solid T.hairline`, sidebar `borderRight: 0.5px solid T.hairline`, palette field `borderBottom: 0.5px solid T.hairline`, palette footer `borderTop: 0.5px solid T.hairline` — `05-settings.jsx:694 (header), 05-settings.jsx:710 (sidebar); 06-palette.jsx:150 (field), 06-palette.jsx:216 (footer)`
- **Code:** Full 1px `border-border` utility used instead of a 0.5px hairline: `border-b border-border` (header, palette field), `border-r border-border` (sidebar), `border-t border-border` (palette footer) — `packages/ui/src/features/settings/SettingsDialog.tsx:75; packages/ui/src/features/settings/SettingsSidebar.tsx:92; packages/ui/src/features/palette/SpotlightPalette.tsx:45,119`
- **Note:** Systemic — repeated at every chrome divider in both surfaces. The 0.5px hairline convention exists and is used correctly elsewhere in the same codebase (e.g. AboutPane.tsx:43 `border-[0.5px] border-border`, keybindings-style tables), so this is an inconsistent application, not a missing capability. Fix: `border-b-[0.5px]` / `border-r-[0.5px]` / `border-t-[0.5px]` in place of the bare `border-*` utilities.

### 14.4 `MEDIUM` Settings -> Providers pane -> Executable Path -> 'Browse…' button — missing-element
- **Design:** Executable path row is an input + a 'Browse…' button (StgBtn) side by side for picking the binary — `05-settings.jsx:319-324`
- **Code:** Executable path row renders only the text input; no Browse/file-picker button anywhere in the Providers pane — `packages/ui/src/features/settings/panes/providers/ProviderConfigForm.tsx:99-113`
- **Note:** grep for 'Browse' across features/settings/ returns zero results.

### 14.5 `MEDIUM` Settings -> Providers pane -> 'Enforce AskUserQuestion' / 'Start in Plan Mode' rows — state
- **Design:** Rendered as checkbox choice rows (StgChoiceRow): a 17x17 rounded-5 box with a checkmark glyph when checked, hover background, distinct from the on/off toggle rows used elsewhere in Settings — `05-settings.jsx:120-148 (StgChoiceRow), used at 05-settings.jsx:340-347`
- **Code:** Both rows render as a shadcn `Switch` (pill toggle) instead of a checkbox control — `packages/ui/src/features/settings/panes/providers/ProviderConfigForm.tsx:153-186 (ProviderToggles)`
- **Note:** Design deliberately uses two distinct control languages — switches for on/off preference rows (notifications, feature defaults) vs checkboxes for these two feature-enable rows. Production collapses both to Switch everywhere.

### 14.6 `MEDIUM` Settings -> shared Switch primitive (toggle rows across Notifications / Providers) — spacing
- **Design:** Toggle switch track 38x22px, thumb 18x18px, thumb travel 16px — `05-settings.jsx:49-66 (SwToggle)`
- **Code:** `h-5 w-9` track = 12x32px (h-5=12px, w-9=32px per --spacing-5/--spacing-9), thumb `h-4 w-4` = 8x8px, `translate-x-[20px]` — `packages/ui/src/components/ui/switch.tsx:9-24`
- **Note:** Shared ui/ primitive used throughout Settings (ToggleRow, ProviderTuningDefaults, ProviderToggles). Track is noticeably smaller and a different aspect ratio than the design (12x32 vs 22x38); thumb is 8px vs 18px. Suggested fix: `h-[22px] w-[38px]` track, `size-[18px]` thumb, `translate-x-[16px]`.

### 14.7 `MEDIUM` Settings -> Pane section headings (General / Notifications / Providers / Remote Access) — typography *(adjusted by verifier)*
- **Design:** StgHeading: fontSize 17, fontWeight 700 — `05-settings.jsx:115-117`
- **Code:** `text-heading` (15px, not 17px = text-title) with inconsistent weight: `font-medium` (500) in GeneralPane/ProvidersPane, `font-semibold` (600) in RemoteAccessPane — none reach 700 — `packages/ui/src/features/settings/panes/general/GeneralPane.tsx:37,42; packages/ui/src/features/settings/panes/providers/ProvidersPane.tsx:35; packages/ui/src/features/settings/panes/remote-access/RemoteAccessPane.tsx:15,26`
- **Note:** Systemic — every pane heading is one type-scale rung too small (15px vs 17px) and under-weight. globals.css defines `--text-title: 17px` (line 754) which is unused here; `text-title font-bold` would match design exactly.
- **Verifier correction:** Drift is real for ProvidersPane.tsx:35 (provider name — design 05-settings.jsx:310 is 17px/700) and RemoteAccessPane.tsx:15,26 (design StgHeading 'Remote Access' at 05-settings.jsx:538, 17px/700), where code renders text-heading (15px) at 500/600. But GeneralPane.tsx:37,42 ('Appearance'/'Worktree Directory') have NO StgHeading counterpart: the design's General pane has a single 'General' StgHeading (05-settings.jsx:234, missing — finding 8) and its sections are labeled by StgLabel at 12px/600 ('Accent theme' :236, 'Worktree directory' :258). Bumping those two h3s to text-title/font-bold would over-correct; the right fix there is the missing 'General' StgHeading plus 12px/600 section labels. The --text-title:17px token claim (globals.css:754) is accurate.

### 14.8 `MEDIUM` Settings -> Notifications pane -> 'Notifications' section heading — missing-element
- **Design:** StgNotifications renders `<StgHeading>Notifications</StgHeading>` before the Chat/Permission Requests/Other groups — `05-settings.jsx:425`
- **Code:** NotificationsPane has no top-level heading at all — goes straight to the 'Chat' SettingGroup — `packages/ui/src/features/settings/panes/notifications/NotificationsPane.tsx:59-61`
- **Note:** Unlike the General/Providers/Remote panes (which at least have a mis-sized heading), Notifications has none — a visible gap when tabbing into this pane.

### 14.9 `MEDIUM` Settings -> control heights/padding (buttons, text inputs, model dropdown trigger) — spacing
- **Design:** StgInput/StgBtn/StgModelDropdown: fixed height 30px, horizontal padding 10-12px — `05-settings.jsx:80-95 (StgInput), 97-113 (StgBtn), 188-199 (StgModelDropdown trigger)`
- **Code:** Inputs/buttons/dropdown trigger use `px-3 py-1.5` (6px horizontal, 6px vertical — no fixed height), yielding a shorter, narrower-gutter control than the 30px/10-12px design spec — `packages/ui/src/features/settings/panes/general/GeneralPane.tsx:52,59; packages/ui/src/features/settings/panes/providers/ModelDropdown.tsx:41; packages/ui/src/features/settings/panes/providers/ProviderConfigForm.tsx:108; packages/ui/src/features/settings/panes/remote-access/*.tsx (all buttons/inputs)`
- **Note:** Systemic across every Settings/Remote-Access text input and button. `py-1.5`=6px (fractional, standard) so total height ends up content-driven (~26-28px with 13px text) rather than the design's fixed 30px, and `px-3`=6px vs the design's 10-12px horizontal padding is visibly tighter.

### 14.10 `MEDIUM` Settings -> Header close button (X) — spacing
- **Design:** 28x28px hit target, radius 8, `Icon name="xmark" size={13}` — `05-settings.jsx:697-703`
- **Code:** `size-7` = 20x20px hit target (spacing-7=20px, not 28px); icon `<X size={13} />` correctly matches — `packages/ui/src/features/settings/SettingsDialog.tsx:19-29`
- **Note:** Only the button footprint is undersized (20px vs 28px, ~30% smaller); the glyph size is exact. Fix: `size-[28px]`.

### 14.11 `MEDIUM` Command palette -> field search icon — icon
- **Design:** `Icon name="magnifyingglass" size={16}` — `06-palette.jsx:151`
- **Code:** `<SearchIcon className="size-4 .../>` — `size-4` = 8px (spacing-4=8px), not 16px — `packages/ui/src/features/palette/SpotlightPalette.tsx:46`
- **Note:** Classic compressed-scale trap: an integer utility used to hit an exact design px. The same file correctly uses arbitrary `size-[15px]`/`size-[13px]` elsewhere (SpotlightRow.tsx:48,83), showing the author knows the scale is non-standard but missed this one. Fix: `size-[16px]`.

### 14.12 `MEDIUM` Command palette -> results row status badge (M/A/D chip in Changes mode) — spacing
- **Design:** status chip `width: 16, height: 16, borderRadius: 4` — `06-palette.jsx:195-196`
- **Code:** `size-4 ... rounded-[4px]` — `size-4` = 8px, not 16px (radius correctly arbitrary at 4px) — `packages/ui/src/features/palette/SpotlightRow.tsx:62`
- **Note:** Same compressed-scale trap as the search icon — badge renders at half the intended footprint. Fix: `size-[16px]`.

### 14.13 `MEDIUM` Command palette -> Files mode -> per-file-type icon — icon
- **Design:** `iconForFile(x.f)` resolves an extension-specific icon + color per file (referenced from the shared engine) — `06-palette.jsx:104`
- **Code:** Every file-mode row renders the same generic `FileIcon`, ignoring the extension — `packages/ui/src/features/palette/SpotlightRow.tsx:12-18 (`file: FileIcon`); use-spotlight-results.ts:134-141 (fileRows — no icon resolution)`
- **Note:** A real extension-to-icon resolver already exists in this codebase (packages/ui/src/lib/editor/file-types.ts, used by the Files surface) but SpotlightRow doesn't consume it — an avoidable, already-solved-elsewhere gap.

### 14.14 `LOW` Settings -> field labels (Executable Path / Default Model / Default Session Mode / Default Effort) — typography
- **Design:** StgLabel: fontSize 12, fontWeight 600, color T.text2 — `05-settings.jsx:68-74`
- **Code:** `text-label text-muted-foreground` with no font-weight utility (renders at default 400) — `packages/ui/src/features/settings/panes/providers/ProviderConfigForm.tsx:100; ModelDropdown.tsx:36; SessionModeRadio.tsx:15; ProviderTuningDefaults.tsx:30`
- **Note:** text-label correctly resolves to 12px; only the semibold weight is missing, repeated across 4+ labels in the Providers pane.

### 14.15 `LOW` Settings -> Remote Access field labels (Quick Tunnel / Named Tunnel / Mobile Pairing / Paired Devices) — typography
- **Design:** StgLabel: fontSize 12, fontWeight 600 — `05-settings.jsx:68-74, used at 543,555,577 (Quick Tunnel, Mobile Pairing, Paired Devices labels)`
- **Code:** `text-caption text-muted-foreground` = 11px, default weight 400 — `packages/ui/src/features/settings/panes/remote-access/QuickTunnelSection.tsx:20; NamedTunnelSection.tsx:59; PairingSection.tsx:63; DevicesSection.tsx:48`
- **Note:** Compounds both a size drop (12px->11px) and the same missing-weight issue as the Providers pane labels.

### 14.16 `LOW` Settings -> General pane -> 'General' section heading — missing-element
- **Design:** StgGeneral renders `<StgHeading>General</StgHeading>` as the pane's top-level title before 'Accent theme'/'Worktree directory' — `05-settings.jsx:234`
- **Code:** GeneralPane has no top-level 'General' heading — first visible heading is 'Appearance' — `packages/ui/src/features/settings/panes/general/GeneralPane.tsx:34-39`

### 14.17 `LOW` Settings -> General pane -> Worktree Directory input border — border
- **Design:** StgInput: `border: 1px solid` — `05-settings.jsx:89`
- **Code:** `border-[0.5px] border-input` — a 0.5px hairline instead of a full 1px border, inconsistent with the sibling Executable Path input in ProviderConfigForm.tsx which correctly uses `border border-border` (1px) — `packages/ui/src/features/settings/panes/general/GeneralPane.tsx:52`

### 14.18 `LOW` Command palette -> Symbols mode -> row icon — icon
- **Design:** `bolt` glyph, colored per symbol kind (fn/comp/type/const each get a distinct tint via `kc` map) — `06-palette.jsx:89-93`
- **Code:** `symbol: BracesIcon` — plausible substitute glyph, but same generic icon for every symbol kind, no per-kind tint (icon color is just `isActive ? text-primary : text-mf-text-3`, unlike design's `iconColor: kc[s.k]` which colors the icon itself per kind even when inactive) — `packages/ui/src/features/palette/SpotlightRow.tsx:12-18,48; use-spotlight-results.ts:83-93`
- **Note:** Icon choice (BracesIcon) is a reasonable substitute for 'bolt' and not flagged as wrong-glyph, but the per-kind color coding from the design is lost — all symbol rows read the same regardless of fn/comp/type/const.

### 14.19 `LOW` Settings -> Remote Access -> tunnel/pairing/device loading spinner icon — icon
- **Design:** `Icon name="arrow.clockwise"` (single circular arrow) with `tw-spin` animation — `05-settings.jsx:519`
- **Code:** `Loader2` (dashed partial-ring glyph) with `animate-spin`, used across TunnelStatusRow, QuickTunnelSection, NamedTunnelSection, PairingSection, DevicesSection, RemoteAccessPane — `packages/ui/src/features/settings/panes/remote-access/TunnelStatusRow.tsx:1,22,33; QuickTunnelSection.tsx:1,37; NamedTunnelSection.tsx:1; PairingSection.tsx:1; DevicesSection.tsx:1; RemoteAccessPane.tsx:1,17`
- **Note:** Per the icon-mapping guidance, `arrow.clockwise` maps to lucide `RotateCw`, not `Loader2`. Effect (a spinning loading indicator) reads similarly and Loader2 is a very standard substitute, but it's a different glyph than the design specifies, repeated across 6 files.

### 14.20 `LOW` Command palette -> mode-chip / active-row accent background — color
- **Design:** mode chip and active-row backgrounds use `${ACCENT}14` (opaque hex-alpha over the theme accent) — `06-palette.jsx:154-156 (chip), 182 (active row)`
- **Code:** `bg-primary/10` (chip) and `bg-primary/8` (active row) — Tailwind opacity-modifier syntax on the `--primary` CSS var — `packages/ui/src/features/palette/SpotlightPalette.tsx:50; packages/ui/src/features/palette/SpotlightRow.tsx:43`
- **Note:** NOT flagged as a token trap — this app is confirmed Tailwind v4 (package.json tailwindcss ^4.3.0), where `/opacity` on CSS-var colors resolves via color-mix() and works correctly (unlike the legacy desktop v3 app). Noted only because the alpha values (10%/8%) are close-but-not-identical to the design's ~8% (`14` hex ≈ 7.8%); a cosmetic, sub-2%-alpha difference, not worth more than low severity.

<details><summary>Coverage notes</summary>

Read both ground-truth prototype files in full (05-settings.jsx, 06-palette.jsx) plus component-map.md §4/§7/§8 (appearance system, provider defaults, keybindings spec change) and mainframe-theme.css. Compared against every production file under packages/ui/src/features/settings/** (SettingsDialog, SettingsSidebar, SettingsContent, all 6 panes + shared ToggleRow/SettingGroup) and features/palette/** (SpotlightPalette, SpotlightRow, palette-modes, palette-commands, use-spotlight-results), plus the shared Switch/RadioGroup ui primitives and packages/ui/src/styles/globals.css for real token/spacing/radius values. Verified every class against the compressed spacing/radius scale in globals.css (not assumed). Confirmed Tailwind v4 is in use (package.json `tailwindcss: ^4.3.0`), so `/opacity` modifiers on CSS-var colors are NOT a token trap here (color-mix works) — did not flag any `/NN` opacity usage. Could not run the live app / take screenshots in this pass (no dev server/browser available in this session); relied on source-level px/token computation, which is authoritative per the review brief. Not checked: `store/settings.ts`, `store/theme.ts` internals, or the daemon API contracts behind each pane (out of scope — visual/behavioral parity only). The "Keybindings" tab is confirmed intentionally dropped per an explicit code comment ("No 'keybindings' tab — S4 drops the placeholder pane") — treated as a documented product decision, not a drift, and not reported as missing.

</details>

<a id="area-15"></a>
## 15. Global chrome — toolbar, surface rail, tabs, session bar, window styles

### 15.1 `HIGH` ChatSessionBar -> bar root height — spacing
- **Design:** height: 28 (03-content.jsx:36, ChatSessionBar root) — `/tmp/parity-audit/design-current/03-content.jsx:36`
- **Code:** className includes `h-7` — under the app's compressed spacing scale (globals.css `--spacing-7: 20px`) this resolves to 20px, not 28px. This is exactly the false-"matches" trap the scale caveat warns about (the digit 7 looks like it encodes 28px under standard Tailwind math but doesn't here). — `packages/ui/src/features/chat/thread/ChatSessionBar.tsx:77`

### 15.2 `HIGH` Global chrome -> Window style 'unified' -> surfaces-region inset — spacing *(adjusted by verifier)*
- **Design:** Unified shell: window-level `pad`/`gap` are 0 (sidebar sits flush against the window edge and against the main column with zero gap); the floating-card inset instead comes from `SHELL.pad = '4px 10px 10px'` applied specifically to the WorkspaceArea wrapper below the toolbar — i.e. surface cards sit ~10px in from the left/right/bottom window edges, 4px below the toolbar. — `/tmp/parity-audit/design-current/04-engine.jsx:777-781,1442,1460`
- **Code:** `WINDOW_STYLE_GEOMETRY.unified` puts `p-2 gap-2` (4px/4px) on the OUTER `windowRoot` (wrapping sidebar + main column) and another `gap-2` (4px) on the `pane` (between toolbar and SurfaceHost) — but `SurfaceHost`'s own root has no left/right/bottom padding at all, so the surface cards end up flush against the window's left/right/bottom edges with no equivalent to the design's 10px side/bottom inset. The whole default ('unified') window treatment is missing its signature 'floating card with generous margin' look. — `packages/ui/src/lib/appearance/window-style.ts:26-36; packages/ui/src/app/AppShell.tsx:130,147; packages/ui/src/layout/SurfaceHost.tsx:92`
- **Verifier correction:** Drift is real but overstated: the surface cards are NOT flush against the window edges. `windowRoot: 'bg-mf-window p-2 gap-2'` (window-style.ts:27) applies a 4px inset (compressed scale --spacing-2: 4px) around the whole window, so cards sit 4px from the left/right/bottom edges. The actual drift vs the design (04-engine.jsx:778-781: window pad/gap 0 + WorkspaceArea pad '4px 10px 10px' at ~1461): (a) side/bottom card inset is 4px instead of 10px, and (b) the inset is applied at the window level — so the sidebar is also inset 4px where the design keeps it flush against the window edge (window pad 0). The 'floating card' look is diminished (4px vs 10px margin), not missing entirely. Severity is closer to medium than high.

### 15.3 `MEDIUM` ChatSessionBar -> bar root horizontal padding — spacing
- **Design:** padding: '0 12px' (03-content.jsx:39) — `/tmp/parity-audit/design-current/03-content.jsx:39`
- **Code:** `px-3` — compressed scale (`--spacing-3: 6px`) resolves to 6px each side, half the design's 12px. — `packages/ui/src/features/chat/thread/ChatSessionBar.tsx:77`

### 15.4 `MEDIUM` ChatSessionBar -> context meter -> unfilled/low-fill segment color — color
- **Design:** Unfilled segments: `T.text2 + '26'` (≈15% alpha of `#5e5d5a`, i.e. `--muted-foreground`). 50–75% fill tier: `T.amber + '99'`. <50% fill tier: `T.text2 + 'aa'` (~67% alpha of `--muted-foreground`). — `/tmp/parity-audit/design-current/03-content.jsx:29-32,98`
- **Code:** `segmentColor()` <50% branch uses `bg-mf-text-3 opacity-60` and the unfilled-segment fallback uses `bg-mf-text-3 opacity-15` — both keyed to `--mf-text-3` (`#92918d`, matches design's `T.text3`, a lighter/fainter gray) instead of `--muted-foreground`/`T.text2` (`#5e5d5a`, matches exactly). Under-50% and unfilled segments render visibly fainter than the artboard. — `packages/ui/src/features/chat/thread/ChatSessionBar.tsx:25-30,111`

### 15.5 `MEDIUM` Global chrome -> Surface headers (Chat/Files/Run 'SurfaceTabStrip' equivalent) -> strip height — spacing *(adjusted by verifier)*
- **Design:** `SurfaceTabStrip` (shared by chat/files/run) is `height: 36` uniformly. — `/tmp/parity-audit/design-current/04-engine.jsx:876`
- **Code:** Three different, and all-wrong, heights: `FilesTabStrip` and `RunTabStrip` both use `h-[34px]` (2px short), while `ChatCardHeader` (the chat surface's equivalent header) uses `h-[38px]` (2px tall). The three surface headers no longer share one consistent strip height as the artboard's single shared component does. — `packages/ui/src/layout/FilesTabStrip.tsx:132; packages/ui/src/layout/RunTabStrip.tsx:162; packages/ui/src/features/chat/thread/ChatCardHeader.tsx:42`
- **Verifier correction:** Heights are correctly reported (FilesTabStrip.tsx:132 and RunTabStrip.tsx:162 h-[34px]; ChatCardHeader.tsx:42 h-[38px]) and the design is uniformly 36 — but the design's chat surface does NOT use the shared SurfaceTabStrip. SurfaceTabStrip is instantiated only for files (04-engine.jsx:1071) and run (04-engine.jsx:1081); ChatSurface has its own inline header (04-engine.jsx:1031) that also happens to be height: 36. So the 'no longer share one consistent strip height' drift is real (34/34/38 vs uniform 36), but the 'single shared component' framing is wrong.

### 15.6 `MEDIUM` Global chrome -> Window style 'glass' -> surfaces-region inset — spacing
- **Design:** Glass shell: window pad/gap 7px (sidebar↔main), PLUS an additional `SHELL.pad = '4px 4px 0'` around the WorkspaceArea specifically (surface cards inset a further 4px on top/sides, flush at the bottom to align with the sidebar card's bottom edge). — `/tmp/parity-audit/design-current/04-engine.jsx:787-791,1460`
- **Code:** `WINDOW_STYLE_GEOMETRY.glass` correctly applies the outer `p-[7px] gap-[7px]`, but — same root cause as the unified finding — has no equivalent extra `4px 4px 0` WorkspaceArea inset; `SurfaceHost` has zero internal padding. — `packages/ui/src/lib/appearance/window-style.ts:45-55; packages/ui/src/layout/SurfaceHost.tsx:92`

### 15.7 `MEDIUM` Global chrome -> Surface-panel drop shadow (unified vs glass differentiation) — shadow
- **Design:** Unified card shadow: `0 0 0 0.5px border, 0 1px 2px rgba(0,0,0,0.04), 0 6px 18px rgba(0,0,0,0.05)` (3 layers incl. a 6px/18px ambient blur). Glass card shadow is explicitly called out as "slightly deeper": `0 0 0 0.5px border, 0 1px 2px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.06)`. — `/tmp/parity-audit/design-current/04-engine.jsx:777-781,787-791; component-map.md:240`
- **Code:** Both `unified.surface` and `glass.surface` resolve to the SAME token, `--mf-shadow-panel` (`0 0 0 0.5px var(--border), 0 1px 2px rgba(0,0,0,0.05)` — only 2 layers, no ambient/ombré blur layer at all). The two window styles' surface cards are visually indistinguishable in elevation, and neither has the artboard's soft ambient shadow that makes the cards read as floating. — `packages/ui/src/lib/appearance/window-style.ts:33,52; packages/ui/src/styles/globals.css:123-124`

### 15.8 `LOW` ChatSessionBar -> center status -> 'Awaiting' glyph — icon
- **Design:** A plain solid filled circle (`width:7,height:7,borderRadius:'50%',background:st.c`) with the `tw-pulse` opacity/scale keyframe animation — same visual language as the amber 'Ready' dot elsewhere in the app. — `/tmp/parity-audit/design-current/03-content.jsx:70-72`
- **Code:** Renders lucide `CircleDot` (an outlined ring with a small center dot glyph, not a solid disc) at size 12 with Tailwind's generic `animate-pulse` (opacity-only fade). Also diverges from the rest of this codebase's own correct pattern of a plain CSS border/dot spinner (e.g. `ToolbarLaunchControls`'s starting spinner correctly reproduces the design's ring). — `packages/ui/src/features/chat/thread/ChatSessionBar.tsx:47-48`

### 15.9 `LOW` ChatSessionBar -> center status -> 'Thinking'/'Compacting'/'Starting' glyph — icon *(adjusted by verifier)*
- **Design:** A minimal CSS ring spinner: `width/height:10, border:1.5px solid ${color}, borderTopColor:transparent`, `animation: tw-spin`. — `/tmp/parity-audit/design-current/03-content.jsx:63-69`
- **Code:** Renders lucide `Loader2` (a dashed/segmented circular icon glyph) at size 12 with `animate-spin` instead of the design's plain open-ring CSS spinner. — `packages/ui/src/features/chat/thread/ChatSessionBar.tsx:46`
- **Verifier correction:** lucide Loader2 (= LoaderCircle) is NOT a 'dashed/segmented' glyph — that describes lucide `Loader`. Loader2 is a single open circular arc (path 'M21 12a9 9 0 1 1-6.219-8.56'), which is the same visual language as the design's ring-with-transparent-top CSS spinner (03-content.jsx:64-68). The remaining drift is only dimensional: 12px icon vs the design's 10px ring, and ~1px effective stroke (stroke-width 2 in a 24 viewbox at size 12) vs the design's 1.5px border. Low severity stands, but as a size/stroke nit, not a glyph-shape mismatch.

### 15.10 `LOW` Global chrome -> Surface divider (SurfDivider) width — spacing
- **Design:** Divider gutter width is `SHELL.gutter`, driven per window style: 8px for unified/glass, 9px for split. — `/tmp/parity-audit/design-current/04-engine.jsx:778,783,788,1126`
- **Code:** `SurfDivider` hardcodes `6` (px) for its width/height regardless of window style, and `SurfaceHost`'s single-column spacer (used when only one top-row divider slot exists) also hardcodes `width: 6` instead of reading `geo`'s per-style gutter. Split mode additionally loses its distinct 9px (vs 8px) gutter. — `packages/ui/src/layout/SurfDivider.tsx:58; packages/ui/src/layout/SurfaceHost.tsx:104`

### 15.11 `LOW` MainToolbar -> show-sidebar button icon / Inspector toggle icon — icon
- **Design:** `sidebar.left`/`sidebar.right` — a custom rounded-rect-with-a-divider-line glyph (`<rect x=2.5 y=3.5 w=13 h=11 rx=2/><path d='M7 3.5v11'/>` for left; mirrored for right), reused identically for the toolbar's show-sidebar button, the sidebar header's hide-sidebar button, and the inspector toggle. — `/tmp/parity-audit/design-current/01-base.jsx:499-500; /tmp/parity-audit/design-current/02-chrome.jsx:142,235,706`
- **Code:** `MainToolbar.tsx` uses lucide `PanelLeft`/`PanelRight` for its own show-sidebar button and inspector toggle, while `SidebarHeader.tsx`'s hide-sidebar button correctly uses the app's own pixel-accurate custom `SidebarLeftGlyph` (`layout/surface-icons.tsx`) that ports the exact design path. No `SidebarRightGlyph` counterpart exists, so the inspector toggle can't use the matching custom glyph even if desired. Same design icon renders with two different, inconsistent glyph sources depending on which chrome file references it. — `packages/ui/src/layout/MainToolbar.tsx:2,70,160; packages/ui/src/layout/SidebarHeader.tsx:4,81; packages/ui/src/layout/surface-icons.tsx:114-122`

### 15.12 `LOW` Sidebar header -> Update pill — missing-element
- **Design:** An accent-tinted 'Update' pill (`arrow.down` icon + 'Update' label, `${ACCENT}14` bg) sits in the sidebar header next to the traffic lights when an update is available. — `/tmp/parity-audit/design-current/02-chrome.jsx:673-684; component-map.md:64`
- **Code:** absent — `SidebarHeader.tsx` renders TrafficLightsSpacer → flex-1 → Workflows/Tasks/Settings/divider/Hide-sidebar, with no update-pill slot at all. — `packages/ui/src/layout/SidebarHeader.tsx:87-105`

### 15.13 `LOW` ChatSessionBar -> Background tasks pill — missing-element
- **Design:** A small chip (`circle.dotted` icon + count, e.g. '2') showing active background tasks, between the status and the context meter. — `/tmp/parity-audit/design-current/03-content.jsx:78-88`
- **Code:** absent — explicitly deferred per the component's own doc comment ('no task feed in app-tauri yet'), a known/documented gap rather than an accidental omission. — `packages/ui/src/features/chat/thread/ChatSessionBar.tsx:11-13`

<details><summary>Coverage notes</summary>

Read both design ground-truth chrome files in full: 02-chrome.jsx (TrafficLights, TasksButton, LaunchPicker, MainToolbar, SurfaceRail, Sidebar header/footer — sessions-list rows are adjacent but out of this area's scope) and the ChatSessionBar/Composer sections of 03-content.jsx; pulled the window-style/shell geometry block (SHELLS, surfCard, SurfDivider, SurfaceTabStrip) from 04-engine.jsx via targeted greps/reads; read component-map.md §2 (workspace chrome→shadcn), §4 (warm-chrome deltas), §8 (appearance system incl. 8.3 window styles) and §9 (chrome/theming changelog) in full.

Compared against: layout/MainToolbar.tsx, layout/SurfaceRail.tsx, layout/SurfDivider.tsx, layout/SurfaceHost.tsx, layout/FilesTabStrip.tsx, layout/RunTabStrip.tsx (partial — header/strip chrome only, not full tab-drag logic), layout/SidebarHeader.tsx, layout/surface-icons.tsx, lib/appearance/window-style.ts, app/AppShell.tsx, features/chat/thread/ChatSessionBar.tsx + session-bar-status.ts, features/chat/thread/ChatCardHeader.tsx (spot-check for the shared SurfaceTabStrip height comparison), features/run/ToolbarLaunchControls.tsx, and cross-referenced every `mf-*`/shadcn token cited against packages/ui/src/styles/globals.css (`--spacing-*`, `--radius-*`, `--mf-shadow-*`, `--mf-text-*`, `--mf-chip`, `--mf-tab-active`, `--mf-content2`, `--mf-warning`, `--destructive`, `--muted-foreground`) to verify real vs phantom tokens and correct compressed-spacing px math per class.

Not compared in depth (out of this area's explicit scope, or gated behind other audit areas): SidebarShell/session-list rows and filter-pill content (belongs to the sessions/sidebar area), Composer toolbar controls, ThemeEffect.tsx internals (mode/scheme application — spot-checked only via globals.css token cross-reference, not the effect's DOM-attribute logic), RunSurface.tsx/FilesSurface.tsx surface *content* (only their tab-strip chrome headers were reviewed), and live-rendered screenshots (per the prototype README guidance, relied on source comparison; did not spin up the dev server). All findings above are backed by direct design-file line references and code file:line references, not by unverified assumption. One initially-suspected delta (Files/Run active-tab background — `bg-mf-chip` vs the doc's stated `--mf-tab-active`) was checked against the actual `04-engine.jsx` ground truth (not just component-map.md's summary prose) and found to be correct as built (component-map.md's wording was imprecise), so it was dropped rather than reported.

</details>

<a id="area-16"></a>
## 16. Primitives + theme token contract

### 16.1 `MEDIUM` Primitives -> Choice controls -> Checkbox / RadioGroup unchecked border color — color
- **Design:** Radio/Checkbox resting (unchecked) ring uses T.text4 — a solid muted-gray token (light #bcbab5, dark #555870, ocean-light #b6c3c7, velvet-light #c0b6c6, etc.) at 1.5px, clearly visible against the paper/card surface. — `/tmp/parity-audit/design-current/artboards/Primitives.html:112,115 (`border: ${on?5:1.5}px solid ${on?ACCENT:T.text4}`) — T.text4 defined per-scheme in 01-base.jsx:130,183,233,282,333,383`
- **Code:** Both `checkbox.tsx` and `radio-group.tsx` render the unchecked ring with `border-border` — an 8-10%-alpha hairline (light `rgba(0,0,0,0.08)`, dark `rgba(255,255,255,0.10)`), ~8-10x fainter than the design's solid text4 gray. Confirmed live at a real call site (Settings > Session Mode radios) with no className override. — `packages/ui/src/components/ui/checkbox.tsx:10, packages/ui/src/components/ui/radio-group.tsx:13; consumer: packages/ui/src/features/settings/panes/providers/SessionModeRadio.tsx:26-29`

### 16.2 `LOW` Primitives -> Choice controls -> Checkbox / RadioGroup / Switch disabled state — state
- **Design:** The only documented disabled affordance (CardBtn) is `opacity: 0.45 · pointerEvents: none` — matched correctly by Button/Input/Select/Textarea/MenuRow in production. — `/tmp/parity-audit/design-current/artboards/Primitives.html:144 (`<Spec name="disabled" dt="opacity 0.45 · no events">`)`
- **Code:** `checkbox.tsx`, `radio-group.tsx`, and `switch.tsx` all use the stock shadcn default `disabled:opacity-50` instead of the app's own `opacity-[0.45]` convention used everywhere else; `label.tsx` uses a third value, `peer-disabled:opacity-70`. Three different disabled-opacity values across the primitive set for what the design treats as one uniform affordance. — `packages/ui/src/components/ui/checkbox.tsx:13, packages/ui/src/components/ui/radio-group.tsx:16, packages/ui/src/components/ui/switch.tsx:12, packages/ui/src/components/ui/label.tsx:10 (cf. correct usage: button.tsx:12, input.tsx:16, select.tsx:22, textarea.tsx:14, menu.tsx:53)`

### 16.3 `LOW` Primitives -> Menus -> DropdownMenuCheckboxItem / DropdownMenuRadioItem / DropdownMenuSubTrigger / ContextMenuSubTrigger / ContextMenuSubContent row geometry — spacing *(adjusted by verifier)*
- **Design:** Menu rows are dense: 12px label text, `gap-[9px] rounded-sm px-[8px] py-[7px]` (the shared `menuItemVariants` token, ~28px total row height per component-map §4 'menu rows ~28px'), consistently applied to every menu-row-shaped element. — `component-map.md:98 ('menu rows ~28px'); packages/ui/src/components/ui/menu-variants.ts:13-30 (the app's own canonical token, correctly used by DropdownMenuItem/ContextMenuItem/MenuRow/MenuCheckRow/MenuSelectRow)`
- **Code:** `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuSubTrigger` (dropdown-menu.tsx) and `ContextMenuSubTrigger`/`ContextMenuSubContent` (context-menu.tsx) all use raw stock-shadcn `text-body py-1.5 px-2` (13px text, 6px vertical padding) instead of `menuItemVariants()` — inconsistent with the sibling `Item` variants in the same files, which do use the shared token. Currently dormant (no call site renders these specific sub-variants yet), but the next consumer of a submenu/checkbox-menu-item will silently get a taller, larger-type row than the rest of the app's menus. — `packages/ui/src/components/ui/dropdown-menu.tsx:14-37,112-138,140-164; packages/ui/src/components/ui/context-menu.tsx:32-54,56-68`
- **Verifier correction:** The drift is real for DropdownMenuCheckboxItem (dropdown-menu.tsx:121), DropdownMenuRadioItem (:148), DropdownMenuSubTrigger (:25), and ContextMenuSubTrigger (context-menu.tsx:45) — all use raw stock-shadcn 'px-2 py-1.5 text-body' instead of menuItemVariants, and no call site renders them yet (dormant, verified by grep across features/layout/surfaces). But ContextMenuSubContent does NOT belong in the finding: it is a content container, not a menu row, and it already composes the canonical MENU_CONTENT_PADDING (p-[5px]) at context-menu.tsx:62. The actual sub-content offender is DropdownMenuSubContent (dropdown-menu.tsx:46), which uses 'p-1' (2px on the compressed scale) instead of MENU_CONTENT_PADDING.

### 16.4 `LOW` Primitives -> Icon buttons -> shared Button `icon`/`icon-sm`/`icon-lg` variants vs the 22/24/28px design rungs — spacing
- **Design:** Three named icon-button rungs: 22px (sidebar/group header), 24px (pane toolbars), 28px (main toolbar). — `/tmp/parity-audit/design-current/artboards/Primitives.html:147-149 (`<Spec name="22px">`, `"24px"`, `"28px"`)`
- **Code:** The shared `Button` primitive's icon sizes resolve (compressed scale: h/w-N) to 20px (`icon`, h-7 w-7), 16px (`icon-sm`, h-6 w-6), 24px (`icon-lg`, h-8 w-8) — none of the three match the smallest (22px) or largest (28px) named rungs; only `icon-lg` lands on the middle rung. In practice most real toolbar/sidebar buttons bypass this primitive and hand-roll arbitrary `h-[22px]`/`h-[24px] w-[28px]` classes at the call site (MainToolbar.tsx, SidebarHeader.tsx, FilesTabStrip.tsx, etc.), which is the correct pattern — but the shared `Button size="icon*"` variants themselves don't offer a matching 22px or 28px rung, so any future consumer reaching for the shared primitive (rather than hand-rolling) will get the wrong size. — `packages/ui/src/components/ui/button.tsx:29-31`

### 16.5 `LOW` Primitives -> Type scale -> --leading-loose — typography
- **Design:** Exactly three line-height rungs are defined: tight 1.15, normal 1.5 (documented range 1.45-1.58), relaxed 1.65. — `/tmp/parity-audit/design-current/01-base.jsx:56-61 (`const LH = { tight:1.15, normal:1.5, relaxed:1.65 }`)`
- **Code:** Production adds an undocumented 4th rung, `--leading-loose: 1.58`, used only for the user-message 'cool card' body text. The value (1.58) sits at the very top of the design's own stated range for `normal` (1.45-1.58), so this is in-bounds but not a token that exists in the design contract — a future consumer might assume it's a real design rung. — `packages/ui/src/styles/globals.css:765; consumers: packages/ui/src/features/chat/messages/UserMessage.tsx:111, QueuedUserTurn.tsx:171, ReadMoreBubble.tsx:57`

<details><summary>Coverage notes</summary>

Read design ground truth in full: 01-base.jsx (FS/FW/LH/LS/RADIUS/SPACE/DURATION/EASING scales, MF_LIGHT/MF_DARK/MF_LIGHT_OCEAN/MF_DARK_OCEAN/MF_LIGHT_VELVET/MF_DARK_VELVET token objects, the full Icon switch, TAB_TYPES), mainframe-theme.css (full 6-scheme CSS contract + @theme mapping), artboards/Primitives.html (buttons/pills/form-controls/indicators/icon-library specimens + the intended IconBtn/Radio/Checkbox spec code), and component-map.md §0-9 (ownership boundaries, warm-chrome deltas §4, reconciliation list §5, primitives table §6, appearance system §8). Diffed every design CSS custom property against packages/ui/src/styles/globals.css variable-by-variable (both directions, via `comm`) across all six mode×scheme blocks, verified the @theme inline color/radius/type-scale/spacing/tracking/leading mappings are bit-exact (computed px→rem by hand), and read every file in packages/ui/src/components/ui/ (button, badge, input, textarea, select, checkbox, radio-group, switch, separator, scroll-area, hint, tooltip, popover, dialog, card, avatar, command, context-menu, dropdown-menu, menu, menu-variants, label, confirm-dialog, ws-toast, sonner) plus menu-item geometry consumers. Grepped components/ui for hardcoded hex, `/opacity` modifiers on CSS-var colors, and standard (non-remapped) Tailwind size/radius utilities that would silently mis-resolve under the compressed scale. Spot-checked icon-name→lucide mapping against real call sites (Frame/Crosshair/RotateCw/ExternalLink/Play) and the custom `surface-icons.tsx` glyph set (exact SVG-path ports of the prototype's Icon switch, not lucide lookalikes, for the 4 icons where lucide diverges — this is a deliberate, correct decision documented in the file's own comment). Not checked (out of area scope, deferred to feature-area reviewers): assistant-ui component restyling, actual rendered/screenshotted pixel comparison (used source-level px math per the compressed-spacing caveat instead), Settings/SessionModeRadio's own non-primitive styling, and files outside components/ui/ (e.g. SettingsSidebar.tsx's hardcoded `text-white` was noticed in passing but is out of this area's file scope).

</details>
