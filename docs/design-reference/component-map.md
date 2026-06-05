# Mainframe — Wireframe → Component Map

> **Purpose.** The wireframes (`Workspace Surfaces.html` + review canvases) are a
> **visual spec**, hand-built with inline styles. The production app is **Electron +
> React 19 + Tailwind v4 + shadcn/ui + assistant-ui** (already scaffolded in
> `desktop/`). This document tells the implementer **which real component each
> wireframe element maps to**, and **how to customize it** so the result matches the
> wireframe — removing the guesswork that causes "it doesn't look like the mock."
>
> **Pair this with `handoff/mainframe-theme.css`** — that file makes the colors,
> radii, type, and focus ring match automatically. This file handles *anatomy*.

---

## 0. Ownership boundaries — who renders what

| Layer | Owns | Rule |
|---|---|---|
| **assistant-ui** | The chat **thread**: message list, user/assistant turns, reasoning, tool cards, markdown, composer input, branch picker, attachments, quoting | Everything *inside* the conversation. Installed via `npx shadcn add r.assistant-ui.com/...` → lives in `components/assistant-ui/*`, **edit those files** to apply our look. |
| **shadcn/ui** | All generic UI **around** the thread: menus, popovers, dialogs, tabs, selects, toasts, tooltips, sidebar, badges, buttons, forms | Use shadcn primitives; theme via `mainframe-theme.css`; only fork a component when our anatomy genuinely diverges (see §3). |
| **Monaco** | The code editor surface + LSP navigation (⌘-click, peek, references) | Decided. Theme via `monaco.editor.defineTheme` fed from `--mf-code-*`. Not a shadcn component. |
| **Custom (ours)** | The workspace shell: typed-surface layout engine, drag-docking, the file-viewer chrome, a few bespoke widgets | Built on shadcn primitives + our tokens. No upstream equivalent. |

**The single most important consequence:** the interactive chat cards we designed
(Thinking / Tool calls / Markdown / Composer) are **not rebuilt** — they're
assistant-ui slots we *restyle*. Our designs are the styling target for those slots.

---

## 1. Chat thread → assistant-ui (restyle, don't rebuild)

| Wireframe element (module) | assistant-ui equivalent | Customization to match wireframe |
|---|---|---|
| Chat transcript / message list | `ThreadPrimitive.Root` + `Viewport` + `Messages` | Warm `--background`; our 22px gutter; `--thread-max-width` to taste |
| Assistant message body | `AssistantMessage` + `MessagePrimitive.GroupedParts` | `text-foreground`, our prose spacing |
| **Thinking / reasoning card** (10) | `Reasoning` (`ReasoningRoot/Trigger/Content`) | Swap Brain icon for our `sparkles`; "Thought for Ns" trigger copy; our collapse chevron |
| **Tool-call cards** (09) | `ToolGroup` + `ToolFallback`, or a **custom Tool UI** per tool | Our card chrome (radius `lg`, hairline, status dot). Bespoke tools (Read/Search/Edit) = registered Tool UIs styled to the wireframe |
| Markdown rendering (08) | `MarkdownText` (`@assistant-ui/react-markdown`) | Port our `window.MD` styles into the `defaultComponents` map (headings, code, tables, lists) |
| Code block in chat | assistant-ui **Syntax Highlighting** (Shiki) | Feed Shiki a theme built from `--mf-code-*` |
| **Composer** (03) | `ComposerPrimitive.Root/Input/Send` | Our composer shell radius `lg`; chips row = our `ComposerSelect`s (see §2); send = primary icon button |
| User message bubble (11) | `UserMessage` (`bg-muted` bubble) | Replace with our **cool card**: `--mf-um-card` bg, `--mf-um-edge` border, radius `xl` |
| Edit / branch / copy actions | `ActionBarPrimitive`, `BranchPickerPrimitive` | Icon buttons via our `Button` ghost variant |
| Quote-selection pill (03) | assistant-ui **Quote** / `SelectionToolbarPrimitive` | Our dark pill styling |
| Context/attachment chips (11) | `AttachmentPrimitive` | Our ext-tile + thumbnail design language |

---

## 2. Workspace chrome → shadcn

| Wireframe element (module) | shadcn component | Customization to match wireframe |
|---|---|---|
| **Right-click editor menu** `EditorContextMenu` (03) | **`ContextMenu`** (shadcn ships it for right-click) | Items + groups already match our spec (Copy / Copy Reference / Go to Def / Find Refs / accent **Add Agent Context**). Radius `md`, `--popover` bg, `--mf-shadow-pop` |
| **Popover system** `Popover`/`PopCard` (13) | **`Popover`** | Padding 5px, radius `md`, `--mf-shadow-pop`. Our `PopSelectRow` = the content rows |
| Model selector (03) | `Popover` or `Select` + provider grid | Locked-provider state = disabled items with lock icon; keep our two-tier provider/model layout |
| Permission / effort chips `ComposerSelect` (03) | **`Select`** (or `DropdownMenu`) | Render as a 20px pill trigger (icon + label + chevron), not a full-width select |
| **Effort / features controls** `EffortPicker`/`FeaturesPopover` (03) | **`Select`** + **`Popover`** of `Toggle` rows | Driven by `AdapterModel.supportedEfforts` + boolean caps — render only what the selected model advertises; Ultracode↔xhigh coupling; see §7 |
| **Command palette ⌘O** (06) | **`Command`** (cmdk) | assistant-ui also uses cmdk → consistent. Our row layout, kbd hints, section headers |
| **Settings** (05) | **`Dialog`** + **`Tabs`** + `Switch`/`Select`/`Input`/`Label`/`RadioGroup` | Our left-nav pane layout inside the dialog; `--popover` surface |
| Branch switcher `BranchPopover` (13) | **`Popover`** + **`Command`** (searchable) | Our Local / worktree / Remote grouped sections; `+ new session` / delete actions |
| Tabs (surface/editor tabs) (04) | `Tabs` *or* keep custom | Editor tabs are custom (close/split/drag); style to match `Tabs` token treatment. Active = `--mf-tab-active` |
| **Sidebar** (02) | shadcn **`Sidebar`** primitive | Our session list density; collapsible groups = `Collapsible` |
| Session rows `SessionRowDense` (02) | Custom on `Sidebar` rows | Keep our dense row (status dot, worktree, PR, tags) |
| Tasks / Todos (12) | `Checkbox` + `Collapsible` / `Accordion` | Our grouped Global/Project sections, strike-through done |
| Filter / tag pills (02) | **`Badge`** / **`Toggle`** | Pill radius `full`; active = `--primary` tint |
| Icon buttons (`gActionStyle`, `PvToolBtn`, toolbar) | **`Button`** `variant="ghost" size="icon"` | 22–28px; hover `--accent` |
| Primary / secondary buttons | **`Button`** default / secondary | Radius `md`; primary = `--primary` |
| Tooltips (hover titles) | **`Tooltip`** | `delayDuration={0}`; `--popover` bg |
| Toaster / notifications (14) | **`Sonner`** (toast) | Our toast chrome + `--mf-shadow-pop` |
| Connection banner / error boundary (14) | **`Alert`** | `--destructive` for errors; warm warning = `--mf-warning` |
| Tutorial coach-marks (14) | `Popover` (anchored) | Our spotlight styling |

---

## 3. Editor & viewers

| Wireframe element (module) | Maps to | Customization |
|---|---|---|
| **Code editor** `CodePane` (03) | **Monaco** | `defineTheme` from `--mf-code-*`; `--mf-code-bg` surface |
| **Inline comment widget** `EditorCommentWidget` (03) | Monaco **view-zone + `createPortal`** hosting a shadcn `Card`+`Textarea`+`Button` | Already built in `desktop/`. Card border = accent when editing; textarea sets `data-noring` |
| Gutter glyph + Submit-review bar (03) | Monaco `glyphMarginClassName` + decorations | Our chat-glyph; "Submit review (N)" bar = `Button` ghost |
| **Diff** `DiffPane` (03) | assistant-ui **Diff Viewer** (standalone) *or* Monaco diff | Tokens from `--mf-code-*`; +/- gutters in `--mf-success`/`--destructive` |
| Terminal `TerminalPane` (03) | **xterm.js** | Theme from `--mf-term-*` |
| `CsvViewer` (15) | shadcn **`Table`** | Sortable header, numeric-aligned cells; sticky header |
| `ImageViewer` / `PdfViewer` / `SvgViewer` (15) | Custom on `ViewerShell` | `--mf-viewer-matte` backdrop; checkerboard from `--mf-viewer-check-a/-b` |
| `UnsupportedViewer` (15) | shadcn `Card` (empty state) | Our no-preview fallback |
| Markdown **viewer** (15) | Reuse assistant-ui `MarkdownText` | Preview ⇄ Source toggle via `Tabs`/segmented |

---

## 4. Warm-chrome deltas from shadcn defaults (apply globally)

These are the systematic ways our look differs from stock shadcn. `mainframe-theme.css`
encodes them, but the implementer should know the intent:

- **Tighter radii.** shadcn default `--radius` is 0.625rem (10px); ours is **8px** base, and most chrome uses `sm` (6px). Buttons/menus feel a touch crisper.
- **Denser.** Control heights are smaller (icon buttons 22–28px, chips 20px, menu rows ~28px) and type runs **10–13px** in chrome vs shadcn's 14px default. Reduce default paddings.
- **Hairline borders.** `--border` is a low-alpha hairline (0.06–0.10), not a solid gray. Dividers are 0.5px.
- **Two-tier shadows.** Use `--mf-shadow-pop` for popovers/menus and `--mf-shadow-modal` for dialogs — both pair a blur with a 0.5px ring so edges read on any surface.
- **Frosted chrome.** Titlebar + sidebar use `--mf-glass` + `backdrop-filter: blur(40px)` — not a solid fill.
- **Accent discipline.** `--primary` (brand blue) is for primary actions, selection, focus only. shadcn's `--accent` is the muted **hover** surface — don't confuse them.

---

## 5. Reconciliation list — verify these before trusting 1:1

Most of our components already mirror shadcn anatomy (popover, select, context menu,
command palette, tabs). The few worth a **side-by-side check** (theme a shadcn sandbox
with `mainframe-theme.css`, drop the stock component next to our wireframe, diff):

1. **User message bubble** — ours is a bespoke "cool card" (gradient + tinted edge), *not* shadcn's `bg-muted` bubble. Biggest intentional divergence; make sure it's built as a custom variant.
2. **Tool-call cards** — our per-tool cards (Read/Search/Edit/Permission/Plan) are richer than `ToolFallback`. Each is a registered Tool UI; confirm the set and their states.
3. **ComposerSelect chips** — rendered as tiny pills, not full `Select` triggers; verify the compact trigger.
4. **Sidebar session row** — dense, multi-affordance; confirm it's a custom row on shadcn `Sidebar`, not the default menu item.
5. **Editor tabs** — custom (split/close/drag/reorder); they only *look* like `Tabs`.
6. **Inline comment widget** — composition of Card+Textarea inside a Monaco view-zone; not a standalone shadcn pattern.

Everything else: theme + map should land it on the wireframe without surprises.

---

## 6. Primitives & icons → `Primitives.html`

The atoms that everything above composes from are catalogued **in isolation** on
`Primitives.html` (a sibling of this doc + the `Design Tokens Report`). It renders the
**real** components/tokens from the prototype modules, so it can't drift. Use it as the
1:1 visual target when theming the shadcn primitive next to it.

| Primitive (on the page) | Source in prototype | shadcn / assistant-ui target |
|---|---|---|
| **Buttons** — `CardBtn` primary/ghost/danger + disabled | `10-chatcards.jsx` | `Button` default / secondary / destructive |
| **Icon buttons** — 22 / 24 / 28px ghost | toolbar / sidebar / panes | `Button variant="ghost" size="icon"` |
| **Filter pill** — active / count / resting | `FilterPill` (02) | `Badge` / `Toggle` |
| **Tag pill** — row + filter variants | `TagPill` (02) | colored `Badge` |
| **Status / resolved pills** — neutral / good / bad | `ResolvedPill` (10), risk pill | tinted `Badge` |
| **Action pill** — dashed "Add project" | sidebar (02) | dashed ghost `Button` |
| **Text fields** — input / select / textarea | `tdInput` / `tdSelect` (12) | `Input` / `Select` / `Textarea` |
| **Choice controls** — radio / checkbox / labeled check / segmented | Ask card (10), `ClearContextCheck` (10), `ExecModeSeg` (10) | `RadioGroup` / `Checkbox` / segmented `Tabs` |
| **Status dots** — `StatusDot` (session) / `TdStatusDot` (task) | 02 / 12 | custom on `Sidebar` row / cycling `Checkbox` |
| **Icon library** — full `Icon` glyph set (~90) with names | `01-base.jsx` switch | nearest **lucide-react** icon, 1.6px stroke / round caps |

**Why it matters for handoff:** the icon set is otherwise only recorded as a `switch`
in `01-base.jsx` — this page is the inventory the implementer maps to lucide. And it's
the consolidated "stock-shadcn-next-to-ours, diff" reference §5 asks for.

---

## 7. State inventory — what the backend actually drives

> **Read this before building any interactive card.** The prototype was corrected
> repeatedly to **only render fields the backend really carries** (the honesty rule).
> This table is the contract: each component, the **real source type** (verify in
> `desktop/out/src/.../*.d.ts` / `desktop/src/.../*.tsx`), the **fields it may read**,
> and the **states to build**. If a field isn't here, the prototype isn't showing it —
> don't add an affordance for data that doesn't exist.

### Permission card — `ControlRequest`
*Source: `components/chat/PermissionCard.tsx`*
- **Fields:** `toolName: string` · `input: object` (rendered as pretty-printed JSON — **not** a fabricated risk/scope summary) · `suggestions: ControlUpdate[]` (e.g. `{ ruleName, ruleValue }`).
- **Actions:** `onRespond('deny')` · `onRespond('allow')` (Allow Once) · `onRespond('allow', suggestions)` (Always Allow).
- **States:** (a) **with suggestions** → all three buttons; (b) **no suggestions** → Allow Once + Deny only, **no Always-Allow** button; (c) resolved → collapses to a `ResolvedPill` (allowed / always-allowed / denied). *Don't invent risk levels, scopes, or per-arg toggles — none exist.*

### Ask-user-question card — `ControlRequest.input.questions[]`
*Source: `components/chat/AskUserQuestionCard.tsx`*
- **Per-question fields:** `question: string` · `header?: string` (card title; falls back to "Question") · `options: { label: string; description? }[]` · `multiSelect?: boolean`.
- **Behavior:** radio when `!multiSelect`, checkbox when `multiSelect`; an **"Other"** option (`__other__`) reveals a free-text input; **multi-question** requests page with Next → Submit; Submit **disabled until a selection exists**; Skip → `onRespond('deny')`; submit packs answers into `onRespond('allow', undefined, { ...input, answers })`.
- **States:** single vs multi-select · single vs multi-question (Next/Submit nav) · Other-selected (text field) · disabled vs enabled submit · answered (read-only summary).

### Plan-approval card — `ControlRequest.input`
*Source: `components/chat/PlanApprovalCard.tsx`*
- **Fields:** `plan: string` (markdown) · `allowedPrompts?: { … }[]`.
- **Execution mode** (`ExecutionMode`, exact ids/labels): `default` → **Interactive** · `acceptEdits` → **Auto-Edits** · `yolo` → **Unattended** (destructive styling). Plus a **Clear-context** checkbox.
- **Actions:** Deny (optional `feedback` string) · Approve → `onRespond('allow', …, execMode, clearContext)`.
- **States:** plan body (rendered markdown) · with/without allowed-prompts list · exec-mode untouched vs chosen · yolo (destructive tint) · clear-context on/off · denied-with-feedback.

### Session row — `Chat` + `SessionStatus`
*Source: `store/chats.d.ts`*
- **Status (`SessionStatus`):** `idle` · `working` · `waiting` — these are the only three. The status dot maps to exactly these; **there is no "running 21m" timer** (no timer mechanism — don't add elapsed time).
- **Adornments (only if present on the chat):** attached **worktree**, detected **PR** (`DetectedPr`), **queued** message (`QueuedMessageRef`), **todo** rollup (`TodoItem`), tags. Unread = accent dot.
- **States:** idle / working (spinner) / waiting · unread · with-worktree · with-PR · with-queued · plain.

### Composer config + model tuning — chat create/update
*Source: `lib/client.d.ts`, `types/src/adapter.ts` (`AdapterModel`), `types/src/chat.ts` (`SessionTuning`)*
- **Base fields:** `model` + `adapterId` (provider) · `permissionMode: 'default' | 'acceptEdits' | 'yolo'` · `planMode: boolean` · `attachWorktree?`.
- **Model & harness flags are DYNAMIC — never hardcoded.** Each `AdapterModel` advertises `supportedEfforts: EffortLevel[]` (`minimal|low|medium|high|xhigh|max`), `defaultEffort?`, and boolean caps `supportsFast` / `supportsAdaptiveThinking` (Claude) / `supportsPersonality` (Codex). `supportsUltracode` is **derived** = Claude adapter **and** `supportedEfforts.includes('xhigh')` (Codex also advertises `xhigh` as a plain effort, but Ultracode is a Claude-only harness flag). The composer renders effort options + feature toggles as a pure function of these — the UI only ever offers what the selected model lists.
- **`SessionTuning`** (`effort`/`fast`/`ultracode`/`adaptiveThinking`, each `| null` = inherit) rides on the chat. Precedence: `model.defaultEffort` ◄ provider default ◄ per-chat override ◄ live composer toggle. Apply is adapter-translated: Claude → `apply_flag_settings` (live), Codex → `turn/start` overrides (next turn).
- **Composer controls:** the **EffortPicker** (gauge pill) — options from `supportedEfforts`, hidden when empty (Haiku); the **FeaturesPopover** (⚙) — one `Toggle` row per supported feature, hidden when none; ticking **Ultracode locks effort to `xhigh`**.
- **States:** provider **unlocked** (first message) vs **locked** (after first message) · plan on/off · each permission mode · **per model:** effort range (Opus `low–max`, Sonnet `low–high` no-Ultracode, Codex `low–xhigh`, Haiku none) · each feature on/off · Ultracode↔xhigh coupling · all controls **disabled while running**.

### Provider defaults — `ProviderConfig`
*Source: `types/src/settings.ts` (flat key-value, no migration)*
- **Fields:** `defaultEffort?: EffortLevel` · `defaultFast`/`defaultUltracode`/`defaultAdaptiveThinking` (`'true'|'false'`) · Codex-only `personality` (`none|friendly|pragmatic`) · `reasoningSummary` (`auto|concise|detailed|none`) · `verbosity` (`low|medium|high`). All capability-gated off the provider's default model (same dynamic rule as the composer).
- **States (Settings → Provider):** default-effort dropdown (hidden if model has none) · default-feature toggles (gated) · Codex tuning block (only when `adapterId === 'codex'`; personality additionally gated by `model.supportsPersonality`). Seeds new chats via `resolveTuning`.

### Task — `Todo`
*Source: `lib/api/todos-api.d.ts`*
- **Enums (exact):** `status: open | in_progress | done` · `type: bug | feature | enhancement | documentation | question | wont_fix | duplicate | invalid` · `priority: low | medium | high | critical`.
- **Fields:** `number` · `title` · `body` · `labels[]` · `assignees[]` · `milestone?` · `dependencies: number[]` · `order_index` · `created_at` · `updated_at`. *(The prototype surfaces `updated_at` as relative time on rows and a sort key; `assignees` exists in the model but the redesigned list de-emphasizes it — see Rule 3.)*
- **States:** the 3 statuses (dot lifecycle) · 4 priorities (left-rail) · the 8 types (icon/label) · with/without dependencies · with/without milestone · collapsed vs inline-expanded · list vs board view.

**Rule of thumb:** if you need a field that isn't in the relevant `*-api.ts` / `*.d.ts`
type, it isn't real — check the source before adding UI for it.
