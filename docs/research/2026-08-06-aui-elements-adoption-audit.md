# assistant-ui "Elements" adoption audit

**Date:** 2026-08-06 · **Scope:** 14 registry elements vs. `packages/ui/src` · **Status:** research only, no code changed

Placed in `docs/research/` to match the existing convention (`docs/research/2026-07-25-*.md`, five prior primary-source research notes).

## Method

Element claims are cited to the registry JSON payload and read from the `files[].content` source inside it, not from the docs page. Repo claims are cited `file:line`. Every registry item was fetched on 2026-08-06.

---

## Finding 0 — the registry has two tiers, and `elements-*` is the presentational one

`https://r.assistant-ui.com/registry.json` lists 75 items. They split cleanly:

- **Classic components** (`thread`, `tool-group`, `tool-fallback`, `attachment`, `reasoning`, `context-display`, `composer-trigger-popover`, …) import from `@assistant-ui/react` and consume runtime context. The repo has already adopted seven of these into `packages/ui/src/components/ui/assistant-ui/` (1,021 lines), all of which import `useAuiState` / `useScrollLock` / `ToolCallMessagePartComponent`.
- **`elements-*` components** (32 items) import **only** `lucide-react`, `@/lib/utils`, and `./surfaces`. Not one of the 11 fetched has a single `@assistant-ui/react` import. They take fully-derived scalar props and render.

The consequence dominates every verdict below: **the runtime pin (0.14.27) and the external-store runtime are irrelevant to `elements-*`.** No element needs an API the repo lacks, because no element needs an API at all. The real question is never "can we wire it" — it is "is the demo's prop contract richer or poorer than the data we already render."

It is mostly poorer, and several elements carry demo-loop scaffolding in their public props:

| Element | Demo-only prop | Registry source |
|---|---|---|
| `code-diff` | `cycle: number` (animation replay key) | [elements-code-diff.json](https://r.assistant-ui.com/elements-code-diff.json) |
| `web-search` | `cycle: number`, `visibleResults: number` | [elements-web-search.json](https://r.assistant-ui.com/elements-web-search.json) |
| `terminal-block` | `visibleCount: number` | [elements-terminal-block.json](https://r.assistant-ui.com/elements-terminal-block.json) |
| `tool-timeline` | `visibleSteps: number` | [elements-tool-timeline.json](https://r.assistant-ui.com/elements-tool-timeline.json) |
| `subagent-list` | `progress: readonly number[]`, `showSummary`, `summaryAgent` | [elements-subagent-list.json](https://r.assistant-ui.com/elements-subagent-list.json) |

Three elements hardcode result strings: `terminal-block` renders the literal `exit 0` regardless of input; `approval-card` renders `Finished with exit 0`; `web-search` renders `Read 3 sources` for any result count. Two render dead controls: `agent-status`'s pause/rerun button and `empty-state`'s suggestion buttons have no handler prop and no `onClick`.

## Finding 1 — three mechanical blockers apply to every adoption

**(a) The collapsible is Base UI, ours is Radix.** `elements-tool-call` and `elements-tool-timeline` declare `registryDependencies: ["…elements-surfaces.json", "collapsible"]`, and their markup targets Base UI conventions: `group-data-open/trigger`, `group-data-panel-open/trigger`, and `collapsePanel = "h-(--collapsible-panel-height) … data-[ending-style]:h-0 data-[starting-style]:h-0"` ([elements-surfaces.json](https://r.assistant-ui.com/elements-surfaces.json)). The repo's collapsible is Radix — `packages/ui/src/v2/components/ui/collapsible.tsx:2` imports `Collapsible as CollapsiblePrimitive` from `radix-ui`, and the repo styles against `data-[state=open]` + `animate-collapsible-down` (`packages/ui/src/features/chat/tools/shared/card-shell.tsx:121`, `packages/ui/src/features/chat/tools/cards/TaskCard.tsx:96`). Dropping either element in yields an undefined height variable and a chevron that never rotates. Neither `data-panel-open` nor `--collapsible-panel-height` appears anywhere in `packages/ui/src`.

**(b) `elements-surfaces` drags in `tw-shimmer`, already rejected.** Every element imports `./surfaces`, whose registry item declares `dependencies: ["tw-shimmer"]`. `tw-shimmer` is not in `packages/ui/package.json` and not in the lockfile. The repo already has a `shimmer` utility from stock `shadcn/tailwind.css` and uses it at `packages/ui/src/features/chat/thread/ChatThread.tsx:70`. `packages/ui/src/features/session-panel/AgentPlan.tsx:22-23` records the standing decision to inline the one needed recipe rather than import `surfaces`.

**(c) The shadcn CLI cannot install against this config.** `packages/ui/src/v2/components.json` registers `"@assistant-ui": "https://r.assistant-ui.com/{name}.json"`, but per `AgentPlan.tsx:11-16`, `shadcn@4.16.1 add` opens with an interactive "select a component library" prompt the config predates, and answering it rewrites the config and pulls a base-library dependency set. **Every adoption is a manual fetch-and-fork**, following the AgentPlan precedent: sha256-pinned provenance header, `"use client"` dropped (`rsc: false`), `cn` re-aliased to `@v2/lib/utils`, `surfaces` recipes inlined verbatim.

---

## Per-element verdicts

### 1. `thinking-indicator` — **feasible-with-theming (S)**

**Ours:** `GeneratingIndicator` at `packages/ui/src/features/chat/thread/ChatThread.tsx:58-75` (18 lines) + `packages/ui/src/features/chat/thread/use-rotating-phrase.ts` (22). Reads `useAuiState(s => s.thread.isRunning)` (`ChatThread.tsx:59`), rotates five phrases every 2,600 ms (`ChatThread.tsx:55-56`), painted with the stock `shimmer` class (`:70`), mounted inside the viewport after `ThreadPrimitive.Messages` (`:121`).

**Element:** `{ label: string; elapsed?: string; className? }` — a pulsing blue dot, a shimmer-swept label whose entrance animation replays on `label` change (`key={label}`), and an optional mono tabular-nums elapsed readout ([elements-thinking-indicator.json](https://r.assistant-ui.com/elements-thinking-indicator.json), 43 lines).

**Delta.** Ours has the rotation source and the runtime read; the element has neither and needs `label` supplied — which our hook already produces. The element adds two things we lack: the leading pulse dot and the elapsed timer. Our `data-testid="chat-thread-running"` / `chat-thread-running-text` must be preserved.

**Gained:** elapsed-time affordance during long runs (the repo already has the measurement pattern — `useReasoningDuration` at `packages/ui/src/features/chat/messages/ReasoningGroup.tsx:26`); a slightly richer entrance animation. **Lost:** nothing; ours is a strict subset. Only element whose prop contract is a clean superset of our data.

### 2. `tool-call` — **fights-our-data-model (L)**

**Ours:** 16 typed cards, 2,210 lines under `packages/ui/src/features/chat/tools/cards/`, plus 335 lines of infra (`registry.ts` 30, `register-cards.ts` 63, `tool-dispatch.tsx` 42, `ToolResultExpand.tsx` 114, `chat-tool-context.ts` 35, `group-parts.ts` 51) and 634 lines of shared primitives. The de-facto contract is `CollapsibleCardShellProps` at `packages/ui/src/features/chat/tools/shared/card-shell.tsx:48-74`; every card is a native `ToolCallMessagePartComponent` taking **no custom props**, spread from the part at `packages/ui/src/features/chat/tools/tool-dispatch.tsx:22`.

**Element:** `{ label, activeLabel, query, request, result, running, open, onOpenChange }` — all strings, one disclosure, a check glyph ([elements-tool-call.json](https://r.assistant-ui.com/elements-tool-call.json)).

**Delta.** The element has no `isError` and no error rendering; ours threads `isError` through every card plus `stripErrorXml` for the Claude CLI's `<tool_use_error>` wrapper (`packages/ui/src/features/chat/tools/shared/result.ts:84`). It has no truncated-result path; ours has `ToolResultExpand` fetching `GET /api/chats/:chatId/tool-result/:toolUseId`. It pre-stringifies `request`/`result`; ours renders structured payloads — a `structuredPatch` diff, a nested subagent transcript, clickable file paths via `useOpenFile()` (`chat-tool-context.ts:17-22`). It offers one visual for all tools; ours varies icon, verb, target, default-open, and body per tool. Plus blocker (a).

**Gained:** nothing. **Lost:** error states, truncation, structured bodies, per-tool affordances.

### 3. `tool-timeline` — **fights-our-data-model (M); borrow the file-stats idea only**

**Ours:** grouping is daemon-authoritative. `packages/ui/src/features/chat/view-model/map-assistant-blocks.ts:80-98` flattens a `tool_group` `DisplayContent` and calls `toolGroupSummary(memberNames)` (`:96`); the header label is derived in `packages/ui/src/features/chat/view-model/tool-group-summary.ts:10` ("Read 3 files · Searched 2 patterns"). Rendering is the Collapsible `tool-group.tsx` (206), not a rail; `makeChatGroupBy` at `packages/ui/src/features/chat/tools/group-parts.ts:42` only echoes daemon group ids.

**Element:** `{ steps: {verb, chip, icon: LucideIcon}[], visibleSteps, streaming, open, onOpenChange, restingLabel, activeLabel, stats: {file, added?, removed?}[] }` ([elements-tool-timeline.json](https://r.assistant-ui.com/elements-tool-timeline.json)).

**Delta.** The element requires a `LucideIcon` per step and pre-derived verbs, plus the `visibleSteps` demo counter; it has no error/status per step. Our summary vocabulary is hardcoded Claude tool names (`tool-group-summary.ts:19-31`) and is dead on Codex, which declares an empty `explore` set and never forms a group (`packages/core/src/plugins/builtin/codex/adapter.ts:101`). Plus blocker (a).

**Genuinely absent from ours:** the `stats` row — per-file `+N/−N` chips in the group header. That is a real capability gap worth lifting as an idea; the component is not worth lifting.

### 4. `terminal-block` — **fights-our-data-model (M)**

**Ours:** `packages/ui/src/features/chat/tools/cards/BashCard.tsx` (175) — bypasses `CollapsibleCardShell` for a full-width mono command header, reads `args.command ?? args.input` and `args.description` (`:101-102`), regex-sniffs the exit code from the last output line (`/exit\s+(\d+)/i`, `:38`), tones lines heuristically (`:30-35`), on the `bg-mf-term-bg` palette. Separately, the real PTY surface is `packages/ui/src/features/terminal/` (233 lines, xterm + fit addon), and process logs are `packages/ui/src/features/run/ConsolePane.tsx` (203), the only surface with genuine stdout/stderr separation.

**Element:** `{ command, lines, visibleCount, done, variant: "paper"|"ink" }` ([elements-terminal-block.json](https://r.assistant-ui.com/elements-terminal-block.json)). Renders the literal string `exit 0` whenever `done` — there is no exit-code prop at all.

**Delta.** The element cannot express a non-zero exit, an error state, or truncation. `visibleCount` is demo scaffolding. Its `variant="ink"` dark slab is a nice recipe, but the repo already owns `--mf-term-*` tokens.

**Gained:** a marginally cleaner slab. **Lost:** exit codes, error tone, `ToolResultExpand`.

### 5. `code-diff` — **fights-our-data-model (M)**

**Ours, two independent implementations:**
- Chat inline: `packages/ui/src/features/chat/tools/shared/diff.tsx` (235), built on `diff@^9` (jsdiff) `structuredPatch` — **not** CodeMirror. `DiffFromPatch({ hunks: DiffHunk[] })` at `:155`, `DiffFallback` at `:195-203`, `countDiffStats` at `:18`, `reconstructFromHunks` at `:30`. Consumed by `EditFileCard.tsx` (294) and `WriteFileCard.tsx` (162).
- Full editor: `packages/ui/src/features/editor/CmDiffEditor.tsx` (292), the single `@codemirror/merge@6.12.2` `MergeView` host; props at `:68-106`. Plus `diff-nav.ts` (98), `DiffTab.tsx` (133), `DiffHeader.tsx` (100), and the review-panel consumer.

**Element:** `{ filename, additions, deletions, lines: {kind: "context"|"added"|"removed", text}[], cycle }` ([elements-code-diff.json](https://r.assistant-ui.com/elements-code-diff.json)), capped at `max-w-md`.

**Delta.** The element is a flat line list: no hunk headers, no line numbers, no syntax highlighting, no fallback reconstruction, and the `cycle` demo key. It cannot touch `CmDiffEditor` — it is not CodeMirror, so none of the MergeView constraints (`config.a/b` taking `{doc, extensions}`, the comment-gutter threading at `inline-comments/CmDiffEditorWithComments.tsx`) even apply; there is nothing to migrate. Against `shared/diff.tsx` it is strictly weaker.

**Gained:** nothing. **Lost:** hunk structure, line numbers, the `+N/−N` pills already in `EditFileCard`.

### 6. `web-search` — **fights-our-data-model (L, and blocked upstream)**

**Ours:** `packages/ui/src/features/chat/tools/cards/WebFetchCard.tsx` (118) handles **both** `WebFetch` and `WebSearch` (registered twice, `register-cards.ts:44-45`). Note `SearchCard.tsx` (137) is *file* search — `Glob`/`Grep`/`LS` — not web search.

**Element:** `{ query, results: {title, domain}[], visibleResults, searching, cycle }` ([elements-web-search.json](https://r.assistant-ui.com/elements-web-search.json)); hardcodes `Read 3 sources`.

**Delta and the actual blocker.** `WebFetchCard.tsx:11-12` documents that the CLI returns an opaque string with no structured shape to parse, so the body is a single summary paragraph. `SearchCard.tsx:8-9` records that a structured `GrepMatch[]` path was already removed as dead code. **We cannot populate `results[]` from either adapter today.** Adopting this element means first teaching the daemon to parse `WebSearch` result text into titles and domains — a daemon change, not a UI one, and the only element here whose blocker is data availability rather than design.

### 7. `subagent-list` — **fights-our-data-model (M)**

**Ours, three unrelated models:**
- `packages/ui/src/features/chat/tools/cards/TaskCard.tsx` (176) — renders `part.messages: readonly ThreadMessage[]` as a real nested readonly thread at arbitrary depth (`:106-116`), reading `args.subagent_type` / `args.model` (`:123-125`).
- Workflow panel — `workflow-agent-view.ts` (114), `WorkflowAgentRow.tsx` (86), `WorkflowPhaseList.tsx` (59), `workflow-progress.ts` (170). Data model in `packages/types/src/claude-workflow.ts`: `ClaudeWorkflowAgentState = 'start'|'progress'|'done'|'error'|'unknown'` (`:11`), `ClaudeWorkflowAgent { agentId, index, phaseIndex, label, state, model?, attempt?, tokens, toolCalls, durationMs, error?, resultPreview?, lastToolName?, lastToolSummary?, lastProgressAt? }` (`:21-38`).
- `TaskProgressCard.tsx` (153) — the `_TaskProgress` todo checklist.

**Element:** `{ agents: {name, model}[], completedCount, progress: readonly number[], showSummary, summaryAgent }` ([elements-subagent-list.json](https://r.assistant-ui.com/elements-subagent-list.json)).

**Delta.** The element is flat two-field rows with percentage bars. We have no percentage — our agents report `tokens`/`toolCalls`/`durationMs` and a five-state enum including `error`, which the element cannot render (done vs. spinner only). It has no nesting; `TaskCard`'s nested transcript is the whole point of that surface. `showSummary`/`summaryAgent` are demo-loop props.

**Gained:** nothing. **Lost:** nesting, error state, the stale-run neutralization at `workflow-agent-view.ts:34-41`.

### 8. `agent-status` — **feasible-with-theming (S)**

**Ours:** `packages/ui/src/features/chat/composer/BackgroundActivityBar.tsx` (51) + `background-activity-view.ts` (39) + `WorkflowActivityPopover.tsx` (104); the per-agent row is `WorkflowAgentRow.tsx` (86) — dot + label + `tokens · duration` + one detail line, tone map at `workflow-agent-view.ts:78-89`.

**Element:** `{ state: "working"|"waiting"|"done", label, elapsed? }` — a rounded pill: pulse dot or check, truncated label (`max-w-44`), mono elapsed, trailing pause/rerun button ([elements-agent-status.json](https://r.assistant-ui.com/elements-agent-status.json)).

**Delta.** The element's three states map onto ours lossily — our five-state enum has `error`, which has no element equivalent (needs a fourth branch). **The trailing button has no handler prop and no `onClick`** — it is decorative and must be wired.

**Gained:** a clean pill recipe with elapsed, directly useful for the background-activity pills. **Lost:** the error tone and the detail line, unless added back.

**Coordination note:** the right-sidebar revamp and background pills are the in-flight next PR. This element overlaps that work; sequence it with whoever owns that branch rather than landing it independently.

### 9. `approval-card` — **fights-our-data-model (L)**

**Ours:** 915 lines under `packages/ui/src/features/chat/gates/` — `ChatGateMount.tsx` (22) dispatches by `request.toolName` to `AskUserQuestionGate` (197) / `PlanGate` (185) / `PermissionGate` (116), over `GateShell.tsx` (79), with `AskQuestionWizard` (132), `PlanExecModeControl` (63), `PlanClearContextCheck` (26), `build-control-response.ts` (46), `answers.ts` (31), `select-front.ts` (10), `gate-types.ts` (8). Queue-front selection is one gate at a time (`select-front.ts`, entries sorted by `askedAt`). Entry type `ChatPermissionEntry { requestId, request, askedAt }` at `packages/ui/src/features/chat/controller/chat-thread-state.ts:45`; wire types `ControlRequest` (`packages/types/src/adapter.ts:88`) and `ControlResponse` (`:97`).

**Element:** `{ state: "request"|"running"|"done"|"denied", command, title, subtitle, onAllowOnce, onAlwaysAllow, onDeny }` ([elements-approval-card.json](https://r.assistant-ui.com/elements-approval-card.json)) — one shell command, one terminal glyph, three fixed buttons, and the hardcoded terminal copy `Finished with exit 0`.

**Delta against the adapter payloads.** The element models a single approval shape. The daemon normalizes two CLIs into one `ControlRequest`, but the *responses* diverge per gate:
- Claude's answer envelope (`docs/research/adapters/claude/CONSUMED-SURFACE.md`, CLAUDE-CTRL-04) requires `updatedInput` on **every** allow — omitting it makes the CLI reject the request outright, documented at `build-control-response.ts:36-39` — plus `updatedPermissions`, `message`, and a `setMode` forced to `session`.
- "Always allow" is not unconditional: it renders only when `request.suggestions.length > 0` (`PermissionGate.tsx:108`), sourced from the CLI's inbound `permission_suggestions` (CLAUDE-CTRL-01).
- `PlanGate` sends `executionMode` (three-way `default`/`acceptEdits`/`yolo`) and optional `clearContext`; `AskUserQuestionGate` sends `updatedInput.answers` as `Record<question, string|string[]>` with an `__other__` free-text sentinel (`answers.ts:20`). Neither fits three buttons.
- Codex raises three distinct approval methods with different reply shapes — `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput` (`docs/research/adapters/codex/CONSUMED-SURFACE.md`, CODEX-CTRL-01) — normalized daemon-side; `grep -rn codex packages/ui/src/features/chat/gates/` returns nothing.

**On the native aui `approval` gate.** The hook exists in the pinned version: `onRespondToToolApproval?: (options: RespondToToolApprovalOptions) => Promise<void> | void` is declared in `@assistant-ui/core@0.2.21`'s external-store adapter typings. **It is not passed** — the runtime at `packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts:197` supplies only `adapters: { attachments: ATTACHMENT_ADAPTER }`, and `grep -rn "approval" packages/ui/src` returns zero functional hits (doc comments in `build-control-response.ts:38` / `PlanCard.tsx` and an unrelated notifications toggle only). Permissions arrive out-of-band via `control_request` → `extras.permissions`, not in the message stream, so the native gate is bypassed by design; the app seam is `useChatPermissionFront()` (`use-chat-thread-runtime.ts:273`). **This contradicts the standing note that the native approval gate is wired** — worth a separate confirmation pass, but it does not change this verdict: `elements-approval-card` is presentational and would not wire the native gate either way.

**Gained:** nothing. **Lost:** three gate shapes, the queue, and every adapter-required response field.

### 10–13. `composer-slash-commands` / `composer-mentions` / `composer-attachments` / `composer-context` — **fights-our-data-model (L), all four**

**These are not four registry items.** All four docs pages install the same thing: `npx shadcn@latest add "@assistant-ui/elements-composer"`. `r.assistant-ui.com/elements-composer-slash-commands.json` and the three siblings all return 404; the registry has exactly one `elements-composer` item (613 lines) and the four names are prop slices of it. Judge them together.

**Ours:** 4,359 lines under `packages/ui/src/features/chat/composer/` plus a 458-line house trigger engine at `packages/ui/src/components/trigger-engine/`.

**Element ([elements-composer.json](https://r.assistant-ui.com/elements-composer.json)):**

| Slice | Element | Ours |
|---|---|---|
| **slash** | `commands: {name, description, icon}[]` + `onCommand`; fires only when `value.startsWith("/")` — position 0 of the whole field (`:161`) | `trigger-engine` (458) + `skills-trigger-adapter.ts` (30) + `directive-formatter.ts` (43); `TriggerAdapter`/`DirectiveFormatter` contracts at `components/trigger-engine/types.ts:25,31`. Key routing registered into aui via `INTERNAL.useComposerInputPluginRegistryOptional()` (`triggers/ComposerTriggers.tsx:126`) with a `console.warn` fallback at `:131` |
| **mentions** | `people: {name, role}[]` + `onMention`; `/@([\w]*)$/` on the raw string (`:174`) | `mention-adapter.ts` (167) classifying three ways — `fuzzy` (agents + sessions + `searchFiles`), `tree` (`getFileTree`), `fs` (`browseFilesystem`) — async-over-sync cache; `parse-at-token.ts` (67); directories serialize `@path/` and keep the popover open (`directive-formatter.ts:41`); session mentions are their own subsystem with a `@session[label]` wire spelling (`session-references/session-mention.ts:20`) |
| **attachments** | `attachments: {name, meta, state, progress?, kind?}[]` + `onRemoveAttachment`, `dragActive` | **already native** — `AttachmentAdapter` impl (`attachment-adapter.ts`, 110) registered at `runtime/use-chat-thread-runtime.ts:202`, rendered through `ComposerPrimitive.AttachmentDropzone` / `.Attachments` / `AttachmentPrimitive` (`attachments/ComposerAttachmentStrip.tsx`, 135) with a matching sent-turn twin via `MessagePrimitive.Attachments` (`messages/UserAttachments.tsx`, 123) |
| **context** | `usage: {system, tools, messages, total}`, a ring + a breakdown popover; hardcodes a `k` suffix (`:505`) | `thread/ChatSessionInline.tsx` (92), mounted twice in `ChatCardHeader.tsx:73,75`; an 8-segment discrete meter with tiers at 50/75/90; derived by `deriveContextPct` (`thread/session-bar-status.ts:15`) from `contextUsage: { percentage, totalTokens, maxTokens } \| null` (`controller/chat-thread-state.ts:87`) |

**The disqualifier for all four:** the element's input is a single-line `<input>`, not a textarea, and `Enter` unconditionally sends with no `Shift+Enter` newline (`elements-composer.json`, `:368-375`). Its menus are plain absolutely-positioned divs (`MenuSurface`, `:104`) with no portal, no focus management, and no keyboard navigation. Ours intercepts Enter mid-run explicitly because the native Input blocks it unless `thread.capabilities.queue` (`composer/Composer.tsx:83-95`), and paints real text through a transparent-input highlight overlay (`highlight/ComposerHighlight.tsx`).

**One genuine capability gap, in `composer-context`:** the element's three-way `{system, tools, messages}` breakdown is richer than our single percentage. The daemon does not supply that decomposition today (`contextUsage` is one percentage plus two totals; Codex never reports it at all — `controller/chat-thread-state.ts:211`). Claude's outbound `get_context_usage` control request (CLAUDE-CTRL-03) is the plausible source. That is a daemon-side feature request, not an element adoption.

### 14. `empty-state` — **feasible-with-theming (S), but the real gap is elsewhere**

**Ours:** `packages/ui/src/features/sessions/new-thread/WelcomeState.tsx` (73) + `FirstRunState.tsx` (46) + `ChatEmptyState.tsx` (13, the variant router) + `SuggestionRow.tsx` (56), passed into the thread as `<ChatThread emptyState={…} />` (`ChatSurface.tsx:132-141`) and rendered when `messageCount === 0` (`ChatThread.tsx:96,117`). Plus `layout/WorkspaceEmptyState.tsx` (169).

**Element:** `{ greeting, suggestions: readonly string[], className }` ([elements-empty-state.json](https://r.assistant-ui.com/elements-empty-state.json)).

**Delta.** The suggestion buttons take **no callback prop and have no `onClick`** — they cannot start a turn. The "composer" beneath them is a static `<span>Ask anything</span>` next to an arrow glyph, not an input. Ours already renders real, repo-derived suggestions with working handlers plus project chip and branch.

**The actual gap this element does not fill:** there is no shared empty-state primitive anywhere in `components/ui/` or `v2/components/ui/`, and roughly 25 ad-hoc centred-muted-div empties are re-declared per file — a local `Muted` helper at `features/context-panel/ContextInspector.tsx:10-12` duplicated verbatim in `AgentsList.tsx:7-8` and `SkillsList.tsx`, plus `TaskListView`, `TaskColumn.tsx:89`, `DiffTab.tsx:93-99`, `ReviewDiffPane.tsx:35-41`, the viewers, automations, and a parallel set of duplicates in the v2 tree. That warrants a house `EmptyState` primitive; `elements-empty-state` is a chat hero, not a generic one, and would not serve those sites.

---

## Recommended adoption shortlist

Ranked. Every item is a manual fetch-and-fork per blocker (c), following the `AgentPlan.tsx:1-35` provenance-header precedent.

1. **`elements-thinking-indicator` — S, adopt.** The only element whose prop contract is a clean superset of data we already have. Fork ~43 lines, inline the `mono` recipe, keep both `data-testid`s, feed `label` from `useRotatingPhrase` and `elapsed` from a `useReasoningDuration`-shaped hook. No collapsible, so blocker (a) does not apply. Lowest risk, visible gain.

2. **`elements-agent-status` — S, adopt after the right-sidebar branch lands.** Directly useful as the background-activity pill recipe. Costs a fourth `error` branch (upstream has three states) and wiring the decorative trailing button. Overlaps in-flight work — sequence it, do not land it in parallel.

3. **`elements-tool-timeline`'s `stats` row — M, borrow the idea, not the component.** Per-file `+N/−N` chips in the tool-group header is a real gap. The component itself is disqualified by blocker (a) and by `visibleSteps`; lift the ~15-line stats block into the existing `tool-group.tsx` header instead.

Two items worth tracking that are **not** element adoptions:
- A house `EmptyState` primitive to absorb ~25 ad-hoc sites (finding 14).
- A daemon-side `{system, tools, messages}` context breakdown, plausibly via `get_context_usage` (finding 10–13), which would make our existing meter richer without importing anything.

## Do not adopt

| Element | Reason |
|---|---|
| `tool-call` | No `isError`, no truncation, pre-stringified bodies; replaces 16 typed cards with one visual. Blocker (a). |
| `terminal-block` | Hardcodes `exit 0`; cannot express a non-zero exit or an error. `visibleCount` is demo scaffolding. |
| `code-diff` | Strictly weaker than `shared/diff.tsx` (no hunks, no line numbers); irrelevant to `CmDiffEditor`. `cycle` is demo scaffolding. |
| `web-search` | Blocked upstream — neither adapter yields structured results (`WebFetchCard.tsx:11-12`); hardcodes `Read 3 sources`. |
| `subagent-list` | Flat percentage rows; no nesting, no error state. Cannot render `TaskCard`'s nested transcript or the workflow agent model. |
| `approval-card` | Three fixed buttons vs. three gate shapes, a queue, and adapter-required response fields (`updatedInput`, `updatedPermissions`, `executionMode`, `clearContext`, conditional suggestions). |
| `composer-slash-commands` | Slash fires only at position 0 of the field; ours is a 458-line engine with async adapters. |
| `composer-mentions` | Single regex vs. three-way fuzzy/tree/fs classification plus the `@session[…]` wire encoding. |
| `composer-attachments` | Ours is already the native `AttachmentAdapter` path; the element is a strictly poorer re-render of it. |
| `composer-context` | Poorer than our 8-segment meter on the data we have; the richer breakdown it wants is a daemon feature, not a component. |
| `empty-state` | Suggestions have no callback and cannot start a turn; the composer beneath them is a static span. |

All four `composer-*` slices share one root cause: `elements-composer` uses a single-line `<input>` where `Enter` always sends, with unportaled menus and no keyboard navigation.

---

## Verification

Re-pull any element with `curl -sS https://r.assistant-ui.com/elements-<name>.json` and read `files[0].content`; the registry index is `https://r.assistant-ui.com/registry.json`. Registry items carry no version, so re-verification is a content diff, exactly as `AgentPlan.tsx:6-9` prescribes.
