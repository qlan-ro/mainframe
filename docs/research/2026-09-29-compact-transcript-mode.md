# Compact transcript mode: assistant-ui APIs, current rendering, and implementation approach

**Date:** 2026-09-29 · **Scope:** `packages/ui` chat transcript, pinned `@assistant-ui/*`, both adapters' tool shapes · **Status:** research only; this file is the only change.

## Summary

- **The pinned assistant-ui (`react@0.15.13` / `core@0.3.12`) has every engine piece compact mode needs.** These are `MessagePrimitive.GroupedParts` with a custom `groupBy`, `MessagePrimitive.PartByIndex` (with `tools.Override`) for expanding one call back into its verbose card, the `ToolCallMessagePart.timing` field plus the `useToolCallElapsed()` hook for a live timer, and the `useScrollLock` hook. Nothing below needs a version bump. Two helpers exist only in newer releases, and Mainframe doesn't need either: `groupPartByType`'s `"tool-call:<name>"` key and a group-level `counts` tally.
- **assistant-ui has no ready-made "summary row" component.** Its `ToolGroup` is a collapsible titled "N tool calls" that shows the full cards inside. Its `ChainOfThought` pattern is only a `groupBy` recipe. So the compact rows would be Mainframe's own design built on assistant-ui's grouping. That fits the package's layering rule ("assistant-ui owns state and behavior; shadcn owns pixels"). The same package's golden rule still asks for an explicit human decision on this design, so it's listed under open questions.
- **Mainframe already renders through `GroupedParts`** with a `groupBy` that copies the daemon's explore-group decisions. Compact mode should be a second `groupBy` plus a second render branch in `AssistantMessage`. Verbose mode keeps its exact current code path.
- **Both adapters already use Claude-style tool names.** Codex command, file-change, and web-search items arrive as `Bash`, `Write`/`Edit`, and `WebSearch`. A single summarizer keyed on tool name therefore covers both adapters. The per-call data it needs (paths, diff hunks, `isError`, the Bash `description`) is already on the parts.
- **Two data gaps:** tool calls carry no start/completion time, and Codex's structured `commandActions`/`durationMs` are dropped by the daemon. Both are additive fixes.
- **Recommended plan:** persist `transcriptMode` in `store/ui-prefs.ts`, set it from Settings → General → Appearance, and branch in `AssistantMessage`. In compact mode, every non-pinned tool call (plus reasoning and whitespace-only text) coalesces into one `group-activity` block per stretch between prose. The block renders rows from a pure `buildCompactRows(parts)` in `view-model/compact/`. Clicking a row expands its calls into the unchanged verbose cards through `MessagePrimitive.PartByIndex`. Plan, question, and workflow tools stay as full cards. Permission gates already live outside the transcript and are unaffected.

---

## Part 1: Verified facts about assistant-ui

### 1.1 Pinned versions, and what the latest release adds

| Package | Pinned (installed) | Latest on npm (2026-09-29) |
|---|---|---|
| `@assistant-ui/react` | `0.15.13` (`packages/ui/package.json:15`; lockfile `pnpm-lock.yaml:508`) | `0.15.22` (`npm view @assistant-ui/react version`) |
| `@assistant-ui/core` | `0.3.12` (`pnpm-lock.yaml:479`) | `0.3.21` (`npm view @assistant-ui/core dist-tags.latest`) |
| `assistant-stream` | `0.3.37` (`node_modules/.pnpm/assistant-stream@0.3.37`) | n/a |

`packages/ui/CLAUDE.md` requires the whole `@assistant-ui/*` set to be pinned to exact versions together.

I read the `@assistant-ui/react` CHANGELOG from 0.15.14 through 0.15.22 ([CHANGELOG.md](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react/CHANGELOG.md)). No entry changes `GroupedParts`, `PartByIndex`, tool-call `timing`, or `useToolCallElapsed`. The two grouping additions after our pin are below. Neither blocks this work.

- **`groupPartByType` key `"tool-call:<name>"`.** Present in `core@0.3.21` (`dist/react/utils/groupParts.d.ts:46`: `type GroupPartType = PartState["type"] | "standalone-tool-call" | \`tool-call:${string}\``). **Absent in 0.3.12**, where the type is `PartState["type"] | "standalone-tool-call"` ([groupParts.ts:51 @ core@0.3.12](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/react/utils/groupParts.ts#L51)). The docs ([Part grouping guide](https://www.assistant-ui.com/docs/guides/part-grouping); [message API reference](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/(reference)/api-reference/primitives/message.mdx)) describe it without a version note. **This is newer-only.**
- **`GroupPart.counts`** (`{running, complete, incomplete, requiresAction}`). Present in `core@0.3.21` (`dist/react/primitives/message/MessageGroupedParts.d.ts:8-26`). **Absent in 0.3.12**, where `GroupPart` is `{type, status, indices}` only ([MessageGroupedParts.tsx:28-32 @ core@0.3.12](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/react/primitives/message/MessageGroupedParts.tsx#L28-L32)). The Part grouping guide documents `counts` without a version note. **This is newer-only.** Compact mode computes its own per-row status, so it doesn't need `counts`.

### 1.2 `MessagePrimitive.GroupedParts` is the supported grouping API

- **Signature.** `groupBy: (part: PartState, context: GroupByContext) => readonly TKey[] | null`, where `TKey` is `` `group-${string}` ``. It also takes `indicator?: "never" | "empty" | "no-text" | "always"` and a `children` render function that receives `{ part, children }`. Sources: installed `@assistant-ui/core/dist/react/primitives/message/MessageGroupedParts.d.ts:44-113`; [MessageGroupedParts.tsx:108-121 @ core@0.3.12](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/react/primitives/message/MessageGroupedParts.tsx#L108-L121).
- **Adjacency only.** "Adjacent parts that share a prefix coalesce into the same group" (`MessageGroupedParts.d.ts:62-66`). The docs add: "GroupedParts groups adjacent runs. If the same key appears again later, it becomes a new group in that position" ([Part grouping guide](https://www.assistant-ui.com/docs/guides/part-grouping)). The tree comes from `buildGroupTree(paths, toolCallIds)` ([groupParts.ts:169 @ core@0.3.12](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/react/utils/groupParts.ts#L169)). Consequence: `groupBy` sees one part at a time with no neighbours, so it **cannot express "merge consecutive same-kind calls, skipping reasoning in between."** That merge has to happen inside the group's renderer, over `indices`.
- **Group status.** "running when any contained part runs, otherwise it mirrors the last contained part" (`MessageGroupedParts.d.ts:9-13`; installed `core/dist/utils/getGroupStatus.js`).
- **Group identity is stable during streaming.** Group nodes are keyed by `idKey` (the first contained tool call's id) or else the structural `nodeKey` (installed `MessageGroupedParts.js`, `renderNode`; `groupParts.d.ts:80-100`). A compact block that grows while calls stream in keeps its React identity, so per-row expansion state survives.
- **Leaf renders are lazy.** A leaf part renders only when its `MessagePartChildren` element mounts (installed `MessageGroupedParts.js`, `renderNode`). A group renderer that never mounts its `children` pays nothing for the verbose cards it hides.
- **Memoization.** The tree is memoized on `[parts, groupBy[GROUPBY_MEMO_KEY] ?? groupBy, toolUIs]` (installed `MessageGroupedParts.js`). A module-level `groupBy` function keeps a stable identity and memoizes correctly without `groupPartByType`.
- **`groupPartByType` and `"standalone-tool-call"`.** This helper builds a `groupBy` from a `part.type` → key map. `"standalone-tool-call"` matches MCP-app calls, or calls whose aui tool-UI registry entry sets `standalone` ([groupParts.ts:79-100 @ core@0.3.12](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/react/utils/groupParts.ts#L79-L100)). **Mainframe doesn't register tools in aui's tool-UI registry.** Its registry is its own `TOOL_REGISTRY` map (`packages/ui/src/features/chat/tools/registry.ts:17`). A repo-wide grep finds no `makeAssistantToolUI`/`useAssistantToolUI` call, only a comment at `registry.ts:5`. So `"standalone-tool-call"` would never match our tools. Pinning specific tools has to branch on `part.toolName` inside a custom `groupBy`, which the type docs endorse ("Use an inline function only when the helper isn't expressive enough (e.g. branching on `part.toolName` …)", `MessageGroupedParts.d.ts:70-75`).

### 1.3 The legacy grouping APIs are deprecated

- `MessagePrimitive.Parts` `components.ToolGroup` / `ReasoningGroup` → "@deprecated Use `<MessagePrimitive.GroupedParts>` with a custom `groupBy` instead" (installed `core/dist/react/primitives/message/MessageParts.d.ts:100-121`).
- `components.ChainOfThought` → "@deprecated Use `<MessagePrimitive.GroupedParts>` with a `groupBy` that returns `["group-thought", ...]`" (`MessageParts.d.ts:131-137`).
- `MessagePrimitive.Unstable_PartsGrouped` → "@deprecated Prefer `<MessagePrimitive.GroupedParts>` for adjacent grouping … Keep this primitive only for non-adjacent clustering" (installed `react/dist/primitives/message/MessagePartsGrouped.d.ts:145-149`). `Unstable_PartsGroupedByParentId` is deprecated in favour of `Unstable_PartsGrouped` (`:176`).
- `makeAssistantToolUI` → "@deprecated Put `render`/`renderText` on the matching toolkit entry, or use `MessagePrimitive.Parts` inline tool render overrides" (installed `core/dist/react/model-context/makeAssistantToolUI.d.ts:10-12,26-28`). `packages/ui/CLAUDE.md` already records the decision to drop it.

**Do not build compact mode on any of these.**

### 1.4 Official chain-of-thought and tool-group examples

- **Chain of thought.** [Chain of thought guide](https://www.assistant-ui.com/docs/guides/chain-of-thought) ([source mdx](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/guides/chain-of-thought.mdx)) nests `reasoning` → `["group-chainOfThought","group-reasoning"]` and `tool-call` → `["group-chainOfThought","group-tool"]`. It renders `ReasoningRoot` and `ToolGroupRoot`/`ToolGroupTrigger count={part.indices.length}` inside a plain wrapper.
- **Registry `ToolGroup`.** [tool-group.aui.tsx](https://github.com/assistant-ui/assistant-ui/blob/main/packages/ui/src/components/react/assistant-ui/elements/tool-group.aui.tsx) is a collapsible (closed by default) whose trigger reads "`{count} tool calls`". It shows a spinner while active and expands to reveal all cards. There is **no** per-kind summarization, no merging, no diff stats, and no elapsed timer. Mainframe's fork adds a `label` override (`packages/ui/src/components/ui/assistant-ui/tool-group.tsx:78-90`).
- **Elements `tool-timeline`.** The earlier audit ruled this out as a component (Base UI collapsible, demo props). It kept only the per-file `+N/−N` stats idea (`docs/research/2026-08-06-aui-elements-adoption-audit.md`, §3).

**Conclusion:** assistant-ui supplies the grouping engine, not the compact-row look.

### 1.5 Tool-call status, `timing`, and elapsed time

- **Status types.** `ToolCallMessagePartStatus = {type:"requires-action", reason:"interrupt"} | {type:"running"} | {type:"complete"} | {type:"incomplete", reason:"cancelled"|"length"|"content-filter"|"other"|"error"}` (installed `core/dist/types/message.d.ts:222-244`).
- **How a tool call's status is derived.** `result === undefined` → the **message's** status. Any result → `complete` ([normalizePartStatus.ts:59-72 @ core@0.3.12](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/utils/normalizePartStatus.ts#L59-L72)). An error is **not** a status: it is the separate `isError` flag (`message.d.ts:181`). So a failed call reads as `complete` + `isError: true`. A call that finishes with no result text stays `running` until the whole message stops.
- **`timing`.** `ToolCallMessagePart.timing?: ToolCallTiming` (installed `core/dist/types/message.d.ts:186-187`). `ToolCallTiming = { startedAt: number; completedAt?: number }` (installed `assistant-stream/dist/core/utils/types.d.ts:45-50`). `ThreadMessageLike` accepts `timing` on tool-call parts ([thread-message-like.ts:65 @ core@0.3.12](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/runtime/utils/thread-message-like.ts#L65)), and the converter passes it through (`...basePart`, [:184-191](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/runtime/utils/thread-message-like.ts#L184-L191)). **This works with our external-store runtime in 0.15.13.**
- **`useToolCallElapsed()`.** Exported from `@assistant-ui/react@0.15.13` (installed `react/dist/hooks/useToolCallElapsed.d.ts:20`; [source @ react@0.15.13](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/react%400.15.13/packages/react/src/hooks/useToolCallElapsed.ts#L24-L49)). It reads `part.timing`, ticks once per second while `completedAt` is unset **and** the part status is `running`, and returns milliseconds. It returns `undefined` without timing. It requires a **part scope**: use it inside `PartByIndexProvider` (exported, installed `react/dist/index.d.ts`) or `MessagePrimitive.PartByIndex`.
- **`MessagePrimitive.PartByIndex`.** Props `{ index, components }`. It wraps `PartByIndexProvider` and dispatches through the same component config as `Parts`. `tools: { Override }` receives the full part props plus `addResult`/`resume`/`respondToApproval` ([MessageParts.tsx:426-433 and :513-519 @ core@0.3.12](https://github.com/assistant-ui/assistant-ui/blob/%40assistant-ui/core%400.3.12/packages/core/src/react/primitives/message/MessageParts.tsx#L426-L433)). This is how a compact row can mount the unchanged verbose card for one call.

---

## Part 2: Verified facts about Mainframe's rendering today

### 2.1 Render path

- **Pipeline.** Daemon facade → `AcpItemAccumulator` → `convertAcpItems` → `useExternalStoreRuntime` → `AssistantMessage` (`packages/ui/src/features/chat/README.md`, data-flow diagram).
- **`AssistantMessage` already uses `GroupedParts`.**
  - It builds `groupBy = makeChatGroupBy(meta.partGroups)` (`packages/ui/src/features/chat/messages/AssistantMessage.tsx:44`).
  - It renders `<MessagePrimitive.GroupedParts groupBy={groupBy} indicator={isNested ? 'no-text' : 'never'}>` (`:65`).
  - `group-reasoning` goes to `ReasoningGroup`; `group-tool-<id>` goes to `MessageToolGroup` with the summary from the projection (`:69-82`).
  - Leaf `tool-call` goes to `MessageToolLeaf` (`:93-94`).
  - Error turns bypass all of this and render `AssistantErrorBlock` (`:50-60`).
- **`makeChatGroupBy`** only copies the daemon's group ids and never looks at tool names (`packages/ui/src/features/chat/tools/group-parts.ts:42-51`).
- **Tool dispatch.** `MessageToolLeaf` → `resolveToolCard(toolName) ?? ToolFallback`, spreading the native part props (`tools/tool-dispatch.tsx:20-23`). `resolveToolCard` maps `mcp__*` to `_Mcp` (`tools/registry.ts:24-30`). The registered names (`tools/register-cards.ts:30-61`) are:
  - `Edit`, `Write`
  - `Read`, `Glob`, `Grep`, `LS`
  - `Bash`, `ExitPlanMode`, `AskUserQuestion`, `WebFetch`, `WebSearch`, `PushNotification`
  - `_Mcp`, schedule/cron/monitor pills, worktree pills, `Skill`
  - `Workflow`/`RunWorkflow` (launcher row)
  - `Task`
- **Existing group summaries.** `toolGroupSummary` produces "Read 3 files · Searched 2 patterns" for daemon explore groups (`view-model/tool-group-summary.ts:10-45`), computed in the projection (`view-model/convert-acp-item.ts:160-171`). It counts calls; it doesn't name files or directories.

### 2.2 What the daemon groups, and how each adapter names tools

- **Claude.** The daemon groups only Claude's explore set: `Read`, `Glob`, `Grep`, `LS`. It hides `TodoWrite`, the `Task*` progress tools, `EnterPlanMode`, `AskUserQuestion`, and `ToolSearch`. Its subagent tools are `Task` and `Agent` (`packages/core-rs/crates/mainframe-adapter-claude/src/adapter.rs:314-335`).
- **Codex.** Codex declares an empty explore set, hides `todo_list`, and treats `CollabAgent` as its subagent (`packages/core-rs/crates/mainframe-adapter-codex/src/adapter.rs:278-283`). So Codex runs never form a group today.
- **How tool calls reach the wire.** The encoder writes each tool call with `title = <tool name>`. It sets a coarse `kind` from the category (`Explore→Search`, `Progress→Execute`, `Subagent→Think`, else `Other`) and derives `status` from the result (`packages/core-rs/crates/mainframe-acp/src/encoder.rs:218-254`). The UI uses `title` as `toolName` and drops `kind` and `locations` (`view-model/convert-acp-item.ts:100-112`). **The ACP `kind` is too coarse to classify by.** Tool name is the reliable key.
- **Codex maps onto Claude names:**
  - `commandExecution` → `Bash` with `{command}`.
  - `fileChange` → one `Write` (add) or `Edit` (update) per changed file, with `{file_path, …}` and a structured patch parsed from the unified diff.
  - `webSearch` → `WebSearch`.
  - MCP calls → `mcp__<server>__<tool>`.

  Sources: `packages/core-rs/crates/mainframe-adapter-codex/src/thread_item_render.rs:121-172`, `history.rs:60-87`, `web_search_render.rs:19`.
- **Claude input keys** (`docs/research/adapters/claude/CLAUDE-JSONL-SCHEMA.md:718-742`):
  - `Read{file_path}`
  - `Edit{file_path, old_string, new_string, replace_all?}`
  - `Write{file_path, content}`
  - `Bash{command, description?, timeout?}`
  - `Glob{pattern, path?}`, `Grep{pattern, path?, …}`
  - `Task{description, prompt, subagent_type?}`
  - `WebFetch{url, prompt}`, `WebSearch{query}`

### 2.3 Data the summarizer can use

| Need | Source today | Where |
|---|---|---|
| File path | `args.file_path` (Read/Edit/Write, both adapters) | `EditFileCard.tsx:197-199`, `history.rs:73` |
| Diff stats | `result.structuredPatch` → `countDiffStats`; Edit falls back to `computeFallbackHunks(old_string,new_string)` | `tools/shared/diff.tsx:18-28,47-56`; `EditFileCard.tsx:204-207`; `WriteFileCard.tsx:115-116`; hunks come from the diff content's `_meta` (`convert-acp-item.ts:66-76`) |
| Error | `part.isError` (from ACP `status: failed`) | `convert-acp-item.ts:109`; `encoder.rs:227-233` |
| Running | `part.status.type === 'running'` (no result yet while the message runs) | §1.5 |
| Bash intent | `args.command`, and `args.description` (Claude only) | `BashCard.tsx:101-102` |
| Pending permission | `extras.permissions[*].request.toolUseId` | `packages/types/src/adapter.ts:89-103`; `controller/chat-thread-state.ts:51` |
| Start/end time | **none**; item `_meta.timestamp` is the *container's* timestamp, not the call's | `encoder.rs:109-118`; `ItemMetaSchema` has no per-call time (`packages/types/src/acp/extensions-payload.ts:96-109`) |

The diff-stat math currently sits inside a React hook (`useEditCardState`, `EditFileCard.tsx:188-237`). A summarizer needs it as a pure function.

### 2.4 Things compact mode must keep visible

- **Permission / AskUserQuestion / Plan gates are out-of-band.** `ChatGateMount` sits in the thread's sticky footer (`thread/ChatThread.tsx:239`). It is fed from `extras.permissions`, not from message parts (`packages/ui/CLAUDE.md`, "Permissions / ask / plan → DONE"). **Collapsing parts can't hide a pending gate.**
- **Answered decisions render as transcript cards.** `AskUserQuestionCard`, `PlanCard`, and `WorkflowLauncherRow` are in the registry (`register-cards.ts:41-42,57-58`). These carry decision content and should stay full cards.
- **The running footer already exists.** `GeneratingIndicator` shows the pulse dot, a rotating phrase, and elapsed time (`thread/ChatThread.tsx:97-127`; `thread/use-run-elapsed.ts:18-33`). The screenshot's "● Working 2m 09s" footer is effectively this plus the composer's stop button. Compact mode needs no new footer.

### 2.5 Settings and preferences

- **`store/ui-prefs.ts`** is the persisted client-side store for UI chrome: zustand `persist`, `name: 'mf:ui-prefs'`, `version: 6`, with `partialize` and `migrate` (`packages/ui/src/store/ui-prefs.ts:57-162`). Theme and UI scale are also client-local, in `store/theme.ts` (localStorage keys `mf-theme`, `mf-ui-scale`, `:8-9`).
- **The daemon-backed `GeneralConfig`** holds `worktreeDir`, `notifications`, `updateChannel`, and `defaultAdapterId` (`packages/types/src/settings.ts:59-78`). It is edited through `updateGeneralSettings` (`features/settings/panes/general/GeneralPane.tsx:4,31,43`).
- **The Appearance UI** renders `PickerRow`s (a single-select `ToggleGroup`) for UI Size and Mode (`features/settings/panes/general/AppearanceControls.tsx:51-68`). A "Transcript: Verbose | Compact" row fits this pattern directly.

### 2.6 Conventions that apply

- **assistant-ui first, stop and ask on mismatch.** For chat components, research the native option. If it doesn't match the design, present design-vs-native and ask (`packages/ui/CLAUDE.md`, "Golden rule"). The layering is: "assistant-ui owns state and behavior; shadcn owns pixels."
- **Size and testability rules.** Files under 300 lines and functions under 50. A stable `<surface>-<element>` `data-testid` on every interactive element. Pure logic in `view-model/`, not in components (`packages/ui/CLAUDE.md`, Conventions; `features/chat/README.md`, "Load-bearing rules").
- **Design skill.** Reuse primitive variants and semantic tokens. Cover empty, loading, error, running, and disabled states. Verify in the running app across light/dark, narrow widths, and the compact UI scale (`.agents/skills/mainframe-design-system/SKILL.md`). This file has uncommitted edits from another session; I cited the working-tree text.
- **Status glyphs already exist.** `STATUS_ICON` maps running → `LoaderIcon`, complete → `CheckIcon`, incomplete → `XCircleIcon`, requires-action → `AlertCircleIcon` (`components/ui/assistant-ui/tool-status.ts:10-15`). Collapsibles use `useScrollLock` (`components/ui/assistant-ui/tool-group.tsx:46`).
- **E2E specs target verbose test ids.** `packages/e2e/tests-tauri/tool-cards.spec.ts`, `transcript.spec.ts`, `chat.spec.ts`, `editor-diff.spec.ts`, and `stress-matrix.spec.ts` reference `chat-tool-group`/`chat-edit-card`/`chat-bash-card`. **Verbose must stay the default.**

### 2.7 Codex sends richer command data than Mainframe keeps

- **What Codex sends.** The app-server `ThreadItem::CommandExecution` carries `command`, `cwd`, `commandActions: Vec<CommandAction>`, `exitCode`, and `durationMs` ([item.rs:289-316 @ rust-v0.155.1](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L289-L316)). `CommandAction` is `read{command,name,path} | listFiles{command,path} | search{command,query,path} | unknown{command}` ([item.rs:128](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L128)). The local generated schema matches: `codex app-server generate-ts` from `codex-cli 0.155.1` produces `v2/CommandAction.ts` and `v2/ThreadItem.ts`, which describes `commandActions` as "A best-effort parsing of the command to understand the action(s) it will perform".
- **What Mainframe keeps.** `CommandExecutionItem` deserializes only `id, command, aggregated_output, exit_code, status` (`packages/core-rs/crates/mainframe-adapter-codex/src/thread_item_variants.rs:36-43`). `commandActions` and `durationMs` are discarded. The upstream parse is exactly what "Read 3 files" rows need for Codex commands like `sed -n`/`rg`.

---

## Part 3: Recommendations

### 3.1 Architecture decision: assistant-ui grouping vs pre-grouping in the projection

**Recommended: an assistant-ui `groupBy` that marks a whole activity stretch, with merging done by a pure row builder inside the group renderer.** Neither pure-native nor pure-projection works on its own:

- **A per-kind `groupBy` can't merge across reasoning.** `groupBy` only sees one part (§1.2). Keys like `group-read`/`group-edit` would coalesce adjacent Reads, but any reasoning part between two Reads would split them. With interleaved thinking, that is common.
- **Pre-grouping in `convert-acp-item` duplicates what GroupedParts already does.** The projection would compute rows and the renderer would then need to render arbitrary index sets, which means rebuilding tree identity and indicator logic ourselves. It also mixes a display-density preference into the pure message projection, whose ids are a stated contract (`README.md`, "Stable item ids are contract").
- **The hybrid keeps each concern in its natural place.**
  - `groupBy` answers only "is this part activity or prose?"
  - The group renderer gets `indices`, reads `s.message.parts`, and calls `buildCompactRows(parts, indices)` from `view-model/compact/`. That function is pure and fully unit-testable.
  - Group identity, lazy leaves, and running status come from assistant-ui.

Concretely, add `makeCompactGroupBy()` to `tools/group-parts.ts`:

```ts
// module-level → stable identity → GroupedParts memoizes the tree
export const compactGroupBy = (part: PartState): readonly ChatGroupKey[] => {
  if (part.type === 'tool-call') return PINNED_TOOLS.has(part.toolName) ? [] : ['group-activity'];
  if (part.type === 'reasoning') return ['group-activity'];            // see open question 2
  if (part.type === 'text' && part.text.trim() === '') return ['group-activity']; // don't split on blank text
  return [];
};
const PINNED_TOOLS = new Set(['ExitPlanMode', 'AskUserQuestion', 'Workflow', 'RunWorkflow']);
```

Tools in `PINNED_TOOLS` fall through to the existing `MessageToolLeaf` and render as full cards between prose, exactly as today.

### 3.2 The mode toggle and where it persists

- **`store/ui-prefs.ts`.** Add `transcriptMode: 'verbose' | 'compact'` (default `'verbose'`) and `setTranscriptMode`. Include it in `partializeUiPrefs` and bump `version` to 7 with a no-op migration step. Client-local is right: this is display density, like theme and UI scale (§2.5). The mobile app is a separate renderer in its own repo, and the daemon has no reason to know. Don't put it in `GeneralConfig`.
- **Settings.** Add a `PickerRow label="Transcript"` with options `verbose`/`compact` and prefix `settings-appearance-transcript` in `features/settings/panes/general/AppearanceControls.tsx`.
- **Optional quick toggle.** A shortcut or palette action (`features/shortcuts/registry.ts`, next to `chat.find`) and/or a small header toggle in `thread/ChatCardHeader.tsx` (`chat-header-transcript-mode`). This is a product call (open question 1).
- **Consumer.** `AssistantMessage` reads `useUiPrefs((s) => s.transcriptMode)`. Nested subagent transcripts use the same `AssistantMessage`, so they inherit the mode automatically.

### 3.3 Keeping verbose mode untouched

- **Split `AssistantMessage.tsx`.** Move the current `GroupedParts` block verbatim into `messages/VerboseParts.tsx`. Add `messages/CompactParts.tsx`. `AssistantMessage` keeps the error-turn branch, the `MessagePathContextMenu` wrapper, and the footer, and picks the parts component by mode. This also keeps each file under 300 lines.
- **What compact mode may not touch:** `makeChatGroupBy`, `convert-acp-item`'s `partGroups`/`groupSummaries`, the registry, the cards, and every verbose `data-testid`. Existing unit and e2e suites then remain the verbose regression guard.

### 3.4 Row model and summarizer (pure, in `view-model/compact/`)

**Files:**

- `classify-tool.ts` → `toolKind(toolName, args)`. Kinds: `read | search | glob | list | edit | write | bash | fetch | websearch | subagent | mcp | skill | other`. `Task`/`Agent`/`CollabAgent` → `subagent`; `mcp__*` → `mcp`.
- `diff-stats.ts` → `editStats(args, result)` and `writeStats(result)`. This lifts the pure part of `useEditCardState` (`EditFileCard.tsx:197-207`) and `WriteFileCard.tsx:115-116`; both cards then call it, so there is one definition.
- `common-dir.ts` → `commonDir(paths)`. Longest common path-segment prefix, displayed as its last ≤2 segments ("sessions/\_\_tests\_\_"). Returns `''` when the only common ancestor is the root.
- `classify-bash.ts` → `bashSummary({command, description, status, isError})`.
- `build-compact-rows.ts` → `buildCompactRows(parts, indices): CompactRow[]`, where `CompactRow = { id, kind, status, label, detail?, stats?: {added, removed}, indices, startedAt? }` and `id` is the first call's `toolCallId`.

**Merge rules**, applied in order over the block's tool calls, with non-tool parts skipped:

1. Merge a call into the previous row when all of these hold:
   - same `kind`;
   - both are complete and not `isError`;
   - neither is `subagent`, `bash`, or `mcp`, which always get their own row (different commands and servers don't summarize meaningfully).
2. A failed call (`isError`) always gets its own row. It is never absorbed.
3. A running call (`status.type === 'running'`) always gets its own row, so its spinner and timer are unambiguous.
4. A call whose `toolCallId` matches a pending `extras.permissions[*].request.toolUseId` gets its own row with status `awaiting-approval`.

**Labels.** Present tense while running, past tense when done.

| Kind | 1 call | n calls (merged) |
|---|---|---|
| read | `Read SideChatPanel.tsx` | `Read 3 files in sessions/__tests__` (no common dir → `Read 3 files`) |
| edit | `Edited useThreadConfig.ts` + Σstats | same file → `Edited X.tsx (3 edits)`; all paths match `/(__tests__\|\.test\.\|\.spec\.)/` → `Edited 5 test files`; else `Edited 5 files` |
| write | `Created X.ts` when the result text starts with `File created` (Claude wording, unverified for Codex), else `Wrote X.ts` + `+N` | `Wrote 3 files` |
| grep / glob / list | `Searched for "pattern"` / `Found files matching *.tsx` / `Listed src/` | `Searched 4 patterns` / `Listed 3 directories` |
| fetch / websearch | `Fetched docs.example.com` / `Searched the web for "…"` | `Fetched 3 pages` |
| subagent | `Ran agent: <args.description>` | n/a |
| mcp | `Called <server> · <tool>` | n/a |
| other | `<toolName>` | `Used 3 tools` |

**Bash classification (`classify-bash.ts`), most specific first:**

1. **Normalize the command.** Strip leading `VAR=val` assignments, `cd … &&`/`;` prefixes, and a `bash|zsh|sh -lc '…'` wrapper. Take the first pipeline segment.
2. **Match a small table of intent verbs:**
   - lint: `eslint`, `(pnpm|npm|yarn|bun) (run )?lint`, `cargo clippy`
   - typecheck: `tsc`, `… typecheck`
   - test: `vitest`, `jest`, `pytest`, `cargo test`, `… test`
   - format: `prettier`, `… format`, `cargo fmt`
   - build: `… build`, `cargo build`
   - install: `… install|add`
   - git: `status`, `diff`, `log`, `commit`, `push`
   - read: `cat`, `sed -n`, `head`, `tail`
   - search: `rg`, `grep`
   - list: `ls`, `find`
3. **Render by status:**
   - done and ok → `Lint passed` / `Tests passed` / `Typecheck passed` / `Built`
   - `isError` → `Lint failed` (etc.)
   - running → `Running lint…`
4. **Unknown intent:** use Claude's `args.description` verbatim (the CLI's own short description, `CLAUDE-JSONL-SCHEMA.md:724`) when present. Otherwise show the **truncated raw command in mono**. That fallback is always safe.
5. **Don't parse output for a summary.** The screenshot's "formatted 2 folders" needs tool-specific output parsing. That's out of scope for v1; the exit status is the only reliable signal.

**Codex upgrade (additive, optional).** Forward `commandActions`/`durationMs` from `CommandExecutionItem` (§2.7) into the `Bash` input as, e.g., `_commandActions`. `classify-bash` then prefers them: all `read` → a read-kind row that merges with neighbouring Reads ("Read 3 files in src"); `search` → `Searched for "query"`. Touches `thread_item_variants.rs:36-43`, `thread_item_render.rs:121-135`, and `history_convert.rs:61`.

### 3.5 Rendering the block

**`tools/compact/CompactActivityBlock.tsx`**

- Rendered for `case 'group-activity'` in `CompactParts`.
- Reads parts with `useAuiState(useShallow((s) => s.message.parts))` and permissions with `useChatExtras()`.
- Memoizes `buildCompactRows` on `[parts, indices, permissions]`.
- Renders a `div` list of `CompactToolRow`s. **It never mounts `children`**, so verbose leaves stay lazy (§1.2).
- `data-testid="chat-compact-block"`.

**`tools/compact/CompactToolRow.tsx`**

- One muted line (`text-xs text-muted-foreground`, no card frame):
  - leading status glyph from `STATUS_ICON`, with `LoaderIcon animate-spin` while running, and `motion-reduce` respected;
  - `min-w-0 truncate` label;
  - right-aligned mono `tabular-nums` `+N −M` in the existing stat-pill style (`EditFileCard.tsx:38-45`) or the elapsed time.
- Status treatments:
  - error: `XCircleIcon` + `text-destructive` label + first line of the stripped error text (`resolveResultText`, `shared/result.ts:112-126`);
  - awaiting approval: `AlertCircleIcon` + "Waiting for approval".
- A button, `aria-expanded`, `data-testid="chat-compact-row-<firstToolCallId>"`, keyed by domain id per the design skill.

**Live elapsed time.**

- **Preferred source:** real `timing` on the part, then wrap the running row in `PartByIndexProvider index={row.indices.at(-1)}` and call `useToolCallElapsed()` (§1.5). Use `formatElapsedSeconds` (`features/chat/format-duration.ts`) for the `0:38` style.
- **Getting `timing` onto parts:** add `firstSeenAt`/`settledAt` stamps to `AcpItemAccumulator.applyToolCallUpdate` with an injected clock. Stamp `settledAt` when `status` first becomes `completed`/`failed`/`cancelled`. Have `toolPart` emit `timing: { startedAt, completedAt }` (`convert-acp-item.ts:100-112`).
- **Caveat:** a resume replay re-stamps. A call that is still running shows time since reconnect, and history shows no durations (hide values under 1 s).
- **Better long-term source:** a daemon-side start time in `ItemMeta` (Claude: tool_use arrival; Codex: `durationMs`). That's a separate, additive contract change.
- **Fallback if neither lands:** a row-local `useRunElapsed(isRunning)` (`thread/use-run-elapsed.ts`), which resets on remount.

### 3.6 Expanding a row to its verbose card: recommended

Clicking a row toggles local `expanded` state, keyed by `row.id`. Because the block's identity is stable (§1.2), the state survives streaming. When expanded, the row renders for each index in `row.indices`:

```tsx
<MessagePrimitive.PartByIndex index={i} components={{ tools: { Override: VerboseToolOverride } }} />
// VerboseToolOverride = (props) => { const Card = resolveToolCard(props.toolName) ?? ToolFallback; return <Card {...props} />; }
```

This reuses the exact verbose cards: clickable paths, open-diff, `ToolResultExpand`, and the nested `TaskCard` transcript. Wrap the toggle in `useScrollLock` as the ToolGroup fork does (`tool-group.tsx:46`) so expansion doesn't jump the viewport.

Why recommend it:

- Compact rows drop information: stderr, the diff body, the command itself.
- Switching the whole transcript back to verbose just to inspect one call is a poor round-trip.
- Failed rows stay collapsed by default. The destructive glyph and inline error line keep failures visible without taking space.

### 3.7 Things that must stay visible in compact mode

| Item | Treatment | Why |
|---|---|---|
| Pending permission / question / plan gate | Unchanged: footer `ChatGateMount`, plus an "awaiting approval" row state | Out-of-band, never in parts (§2.4) |
| Answered plan / question, workflow launcher | Full card (`PINNED_TOOLS`) | Decision content |
| Failed tool call | Own row, destructive glyph, first error line, expandable | §3.4 rule 2 |
| Error turn (`meta.errorText`) | Unchanged `AssistantErrorBlock` | `AssistantMessage.tsx:50-60` runs before any parts branch |
| Running call | Own row, spinner + elapsed | §3.4 rule 3 |
| Images, non-blank text | Ungrouped; render as today | `compactGroupBy` returns `[]` |

### 3.8 Tests

- **Unit tests with hardcoded expectations** (per the `test-writer` agent's rule against re-deriving expected values), each under `view-model/compact/__tests__/`:
  - `build-compact-rows.test.ts`:
    - merges consecutive Reads across a reasoning part;
    - a Write breaks a Read run;
    - failed and running calls get their own rows;
    - awaiting-approval matched by `toolUseId`;
    - `Bash`/`Task`/`mcp__*` never merge;
    - Edit stats summed;
    - Codex-shaped Edit with empty `old_string` and a `structuredPatch` result.
  - `classify-bash.test.ts`: table-driven over real commands, including `zsh -lc '…'` wrappers, env prefixes, `cd x && pnpm lint`, unknown commands (with and without `description`), and running/ok/error variants.
  - `common-dir.test.ts`: siblings, nested, single path, root-only, Windows-style separators if paths can arrive that way (unverified).
- **Component tests:**
  - `CompactToolRow`: each status glyph; `+N −M`; elapsed ticking under fake timers with `timing` set; expand renders the verbose testid (`chat-edit-card`).
  - `AssistantMessage`: picks `CompactParts` vs `VerboseParts` by `transcriptMode`. Extend the existing stub harness in `messages/__tests__/AssistantMessage.test.tsx:11-45`.
  - `group-parts.test.ts`: covers `compactGroupBy`.
- **Store tests:** extend `store/__tests__/ui-prefs.test.ts` and `ui-prefs-migration.test.ts` for the v7 field and its default.
- **E2E:** leave the verbose specs as they are. Add one `tests-tauri` spec that switches the setting, asserts `chat-compact-block` rows for a scripted multi-tool turn (mock adapter), and expands one row to `chat-edit-card`.
- **Live QA** per the design skill: light/dark, compact UI scale, a narrow zone width, long file names, a 20-call turn, and a Codex session.

### 3.9 Suggested file list

- **Edit:**
  - `packages/ui/src/store/ui-prefs.ts`
  - `features/settings/panes/general/AppearanceControls.tsx`
  - `features/chat/messages/AssistantMessage.tsx`
  - `features/chat/tools/group-parts.ts`
  - `features/chat/tools/cards/EditFileCard.tsx`, `WriteFileCard.tsx` (use the shared `diff-stats`)
- **Add:**
  - `features/chat/messages/VerboseParts.tsx`, `CompactParts.tsx`
  - `features/chat/tools/compact/CompactActivityBlock.tsx`, `CompactToolRow.tsx`
  - `features/chat/view-model/compact/{classify-tool,classify-bash,common-dir,diff-stats,build-compact-rows}.ts` with tests
- **Phase 2 (timing):** `view-model/acp-item-accumulator.ts`, `view-model/convert-acp-item.ts`
- **Phase 3 (Codex semantics):** `mainframe-adapter-codex/src/{thread_item_variants,thread_item_render,history_convert}.rs`
- **Every PR:** a changeset (root `CLAUDE.md`).

---

## Uncertainties

- **"Created" vs "Wrote."** Telling a new file from an overwrite relies on Claude's result wording ("File created successfully at: …"). I didn't verify that string against current CLI output or Codex's `"OK"` result (`thread_item_render.rs:153`). Default to "Wrote" when unsure.
- **Codex command shape.** I didn't confirm from live traffic whether Codex `commandExecution.command` arrives wrapped (`/bin/zsh -lc '…'`). The normalizer should handle both.
- **Running calls with no output.** A tool call that completes with no result text stays `running` until the message ends (§1.5). Rows would spin on such calls. Claude's `Edit`/`Read` normally return text; this needs checking on an empty-output Bash.
- **Timing across resume.** Client-stamped timing is approximate across a resume replay (§3.5). Exact durations need a daemon field.
- **Find-in-chat.** `features/chat/find/` searches rendered DOM text. In compact mode, text inside collapsed calls won't be found until expanded. I didn't check whether that matters to users.
- **Screenshot source.** The target screenshot's semantic Bash lines ("Lint passed, formatted 2 folders") may come from model-written summaries in the source product. The heuristic approach above won't match that wording exactly.

## Open questions

1. **Design vs native (golden rule).** The compact row has no assistant-ui equivalent; the nearest is the registry `ToolGroup` ("N tool calls" collapsible, §1.4). Approve "native `GroupedParts` + Mainframe compact rows", or prefer restyling `ToolGroup` with our summary label? The latter is cheaper but has no per-kind rows and no diff stats.
2. **Reasoning in compact mode.** Should it be absorbed (not rendered, and not breaking merges; the recommendation) or shown as a muted "Thought for Ns" row, which splits runs wherever thinking is interleaved?
3. **Scope of the setting.** A global preference only, or also a per-chat override via a header toggle?
4. **Subagents.** Should `Task` render as a compact row that expands to the nested transcript (recommended), or stay a full card like the pinned tools?
5. **Follow-ups.** Should the daemon-side Codex `commandActions` forwarding and per-call timestamps be scheduled as separate todos?

---

## Appendix: How t3code does it

**Source:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at commit `2cbc24fcae2b5649d7b60b68da72053a37fa82d5` ("chore(release): prepare v0.0.43", 2026-09-29), shallow clone. Paths below are relative to that repo. Permalinks use the base `https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/`. I read the web client and the server ingestion path. The mobile app (`apps/mobile/src/lib/threadActivity.ts`) mirrors the same logic and shares `packages/client-runtime/src/work-log/`; I didn't read it in detail. Everything here comes from reading source. I didn't run t3code.

### A.1 Data model: provider events → activities → work-log entries

- **Adapters normalize tools into seven item types:** `command_execution | file_change | mcp_tool_call | dynamic_tool_call | collab_agent_tool_call | web_search | image_view` ([contracts/providerRuntime.ts:106-114](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/packages/contracts/src/providerRuntime.ts#L106-L114)).
- **Claude classifies by substring match on the tool name** (`classifyToolItemType`, [ClaudeAdapter.ts:1033-1081](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/apps/server/src/provider/Layers/ClaudeAdapter.ts#L1033-L1081)): names containing `bash`/`command`/`shell` become commands; `edit`/`write`/`file`/`patch` become file changes; `task`/`agent` become subagents. Everything else is `dynamic_tool_call`, and that includes `Read`, `Grep`, and `Glob`. The title is a generic string per type ("Command run", "File change", "Tool call"; `titleForTool`, `:1524-1543`). The detail is `"<ToolName>: <command>"` or `"<ToolName>: <JSON input>"`, capped at 400 chars (`summarizeToolRequest`, `:1491-1522`). The tool_use block goes out as `item.started` with `data: { toolName, input }` (`:3089-3142`).
- **Codex maps app-server items by type name.** Titles are "Ran command", "File change", or `"<server> · <tool>"` for MCP (`itemTitle`, [CodexAdapter.ts:740-780](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/apps/server/src/provider/Layers/CodexAdapter.ts#L740-L780)). The detail is the first non-empty field among `query`/`command`/`title`/`summary`/`text`/`path`/`prompt` (`itemDetail`, `:782-804`). Codex computer-use MCP calls get hand-written present/past-tense titles ("Clicking in Safari" / "Clicked in Safari", `:691-738`). **`commandActions` isn't used for labels.** It only passes through as raw `data`; the only non-test hit is a web test fixture (`apps/web/src/session-logic.command-output.test.ts:32`).
- **The server turns item lifecycle events into thread activities:** `item.updated` → `tool.updated` and `item.completed` → `tool.completed`, with `summary = title`, `tone: "tool"`, and a payload carrying `itemType`, `toolCallId`, `status`, `detail`, and `data` ([ProviderRuntimeIngestion.ts:933-1002](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts#L933-L1002)). Non-terminal payloads are projected down before storage (`projectActivityPayload`, `apps/server/src/orchestration/ActivityPayloadProjection.ts:425`).
- **The client derives `WorkLogEntry` rows** ([session-logic.ts:56-95](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/apps/web/src/session-logic.ts#L56-L95)). Each row carries `label`, `detail`, `command`, `changedFiles`, `itemType`, `toolLifecycleStatus`, `toolCallId`, `requestKind`, and a **`tone: "thinking" | "tool" | "info" | "error"`**. `task.progress` activities (subagent progress) get tone `thinking`, and approval activities get `info` (`toDerivedWorkLogEntry`, `:542-680`). `deriveWorkLogEntries` (`:451-515`) drops `tool.started`, `tool.progress`, plan updates, and similar noise. It then collapses the `tool.updated`/`tool.completed` pairs for one call into one row by `tool:<turnId>:<toolCallId>` (`collapseDerivedWorkLogEntries`, `:718-811`). Subagent rows collapse per spawn batch, not by adjacency.
- **Reasoning is not a work entry.** It stays a `ChatMessage` with `role: "reasoning"` and joins tool rows only at the timeline-row stage (A.2).
- **Action classification happens on the client.** `toolGroupAction(entry)` returns `read | edit | command | search | code-search | browser | device | other | update | …` from `requestKind`, `itemType`, `changedFiles`, and `command` ([work-log/presentation.ts:464-498](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/packages/client-runtime/src/work-log/presentation.ts#L464-L498)). A `read` needs `requestKind: "file-read"`, `image_view`, or a dynamic tool titled "read file". **So a Claude `Read` counts as `other`.** It contributes "used N tools", not "read N files", and its row label is the raw detail string `Read: {"file_path":"/tmp/app.ts"}`. That exact string appears as a fixture in `apps/web/src/session-logic.test.ts:1487-1526`.

### A.2 Grouping

All of this is in `deriveMessagesTimelineRows` ([MessagesTimeline.logic.ts:962-1412](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/apps/web/src/components/chat/MessagesTimeline.logic.ts#L962-L1412)). The row kinds are `activity-group | work | work-live | work-toggle | turn-fold | working | thinking | message | …` (`:350-463`).

- **Grouping is by adjacency within one turn.** Nothing is keyed by tool kind.
  - **Run with reasoning (`activity-group`).** A run of consecutive "activity entries" (work entries plus reasoning messages, `isActivityEntry`, `:338-348`) with the same `turnId` becomes one `activity-group` row if it contains at least one reasoning message (`:1159-1201`).
  - **Tool-only run (`work-toggle`).** Consecutive `work` entries form one row (`:1241-1260`). A single tool-like entry renders as a plain `work` row. Anything larger becomes a `work-toggle` summary row (`:1289-1361`).
  - **What breaks a run:** assistant text (any non-reasoning message), a different turn, an `error`-tone entry, a subagent spawn row, an answered-question row, a context-compaction row, or a turn-fold anchor (`:1165-1171`, `:1245-1256`). **Reasoning does not break a run.** It pulls the tool calls into an `activity-group` instead.
- **There's no "show N, then more".** A multi-entry group collapses to **one** summary line. Expanding it shows every entry in a virtualized list capped at `max-h-[min(18rem,50dvh)]` that scrolls internally (`ExpandedWorkGroupEntries`, [MessagesTimeline.tsx:2994-3134](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/apps/web/src/components/chat/MessagesTimeline.tsx#L2994-L3134), class at `:3128`). Each entry then expands again into a mono `<pre>` holding the command, raw command, detail/output, and changed paths, capped at `max-h-64` (`buildToolCallExpandedBody`, `:4413-4462`).
- **While a turn runs, only the latest call is shown.** The trailing run of the live turn is replaced by one `work-live` row showing the latest (or running) entry, and a click expands the whole run (`:1036-1095`, rendered by `LiveWorkEntryTimelineRow`, `MessagesTimeline.tsx:3254-3303`).
- **Settled turns fold behind "Worked for …"** (`deriveTurnFolds`, [MessagesTimeline.logic.ts:643-825](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/apps/web/src/components/chat/MessagesTimeline.logic.ts#L643-L825)).
  - **What folds.** Once a turn settles, every work and reasoning entry before the terminal assistant message hides behind one `Worked for 2m 9s` row. An interrupted turn reads `You stopped after …` instead (`:808-814`). The fold row is a chevron button (`TurnFoldTimelineRow`, `MessagesTimeline.tsx:2355-2378`).
  - **Trailing entries.** A single successful trailing tool call joins the fold. Larger trailing groups and failures stay visible.
  - **What stays visible.** Subagent-spawn and answered-question rows never fold (`:758-764`).
  - **Live turns never fold** ("Nothing folds while the turn is live, which is when traces are watched", `:677`).
- **Disclosure state** lives in list-level `Set`s: turns, work groups, spawn rows, and reasoning messages (`MessagesTimeline.tsx:534-545`). Per thread it goes into an in-memory LRU of 100 threads (`timelineScrollAnchoring.ts:110-141`). It isn't persisted across app restarts.

### A.3 Summary labels

- **Group summaries are counts per action, joined into a sentence** (`summarizeToolGroup` / `toolGroupActionLabel`, [presentation.ts:567-635](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/packages/client-runtime/src/work-log/presentation.ts#L567-L635)):

  ```ts
  case "read":    return `Read ${count} ${count === 1 ? "file" : "files"}`;
  case "edit":    return `Changed ${count} ${count === 1 ? "file" : "files"}`;   // count = distinct changedFiles
  case "command": return `Ran ${count} ${count === 1 ? "command" : "commands"}`;
  case "search":  return `Searched the web ${count} ${count === 1 ? "time" : "times"}`;
  case "other":   return `Used ${count} ${count === 1 ? "tool" : "tools"}`;
  // → "Read 3 files, changed 2 files, and ran 4 commands"
  ```

  Named integrations come first ("Used Chrome integration and ran 1 command", `presentation.test.ts:187`). Approvals count as "Received N updates".
- **A single completed call shows the raw command.** `singleToolCallLabel` returns the MCP presentation name, then `entry.command` **verbatim**, then the title ([MessagesTimeline.logic.ts:47-54](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/apps/web/src/components/chat/MessagesTimeline.logic.ts#L47-L54)). `workEntryDisplayLabel` falls through command → detail → `path` / `path +N more` → title (`:56-70`). A single edit uses the group summary ("Changed 1 file", `:1300-1303`).
- **The live row uses the program name, not the command** (`liveWorkEntryLabel`, `:72-98`):

  ```ts
  const verb = status === "inProgress" ? "Running" : status === "failed" ? "Failed"
    : status === "declined" ? "Declined" : status === "stopped" ? "Stopped" : "Ran";
  return `${verb} ${commandProgramName(command) ?? "command"}`;      // "Running vp", "Ran git"
  ```

  `commandProgramName` ([work-log/commandLabel.ts:1367](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/packages/client-runtime/src/work-log/commandLabel.ts#L1367), 1,369 lines) is a real shell tokenizer. It unwraps `bash|zsh|sh|fish -lc '…'`, `env`/`sudo` with their flags, PowerShell and `cmd`, heredocs, comments, and `cd … &&` setup segments. It returns `null`, and so the label "command", for control flow and builtins (`if`, `for`, `[`, `export`, `source`, …; `:65-200`). Its table tests cover real Codex shapes such as `/bin/zsh -lc 'rg -n … apps/web/src'` → `rg` (`commandLabel.test.ts:6-22`). **Commands are never summarized by intent** ("Lint passed"). The label is the program name while running and the raw command once complete.
- **Built-in MCP tools get a verb tuple:** `[action, running, completed, detail]`, for example `preview_click: ["Click", "Clicking", "Clicked", "in the preview browser"]`. The tuple renders as `Clicking in the preview browser`, `Failed to click …`, `Declined to click …`, or `Stopped clicking …` (`T3_MCP_TOOL_LABELS` and `resolveT3McpToolPresentation`, [presentation.ts:74-186](https://github.com/pingdotgg/t3code/blob/2cbc24fcae2b5649d7b60b68da72053a37fa82d5/packages/client-runtime/src/work-log/presentation.ts#L74-L186)). Other MCP calls show `"<server> · <tool>"` from the Codex title.
- **A reasoning-only group reads `Thought` or `Thought (×3)`.** A mixed group uses the tool summary. A live group reads `Thinking` or the live tool label (`ActivityGroupTimelineRow`, `MessagesTimeline.tsx:2638-2644`). Thought rows show **no duration**. A collapsed thought inside a group previews its first line, with markdown flattened to plain text (`remarkThoughtPreview`, `:2717-2737`; `ReasoningTraceBlock`, `:2743-2829`).
- **Subagents get one row per spawn batch:** `Kicked off 3 subagents` / `Ran 3 subagents` plus a status such as `2 working` (`agentSpawnSummary.ts:28-45`).
- **Per-row diff stats: none.** `+N −M` appears only in the per-turn `ChangedFilesCard` under the assistant message, built from checkpoint diffs (`MessagesTimeline.tsx:3402-3459`; `DiffStatLabel.tsx`).

### A.4 Running state, errors, approvals

- **There's no spinner and no per-tool timer.** A running row's label gets a moving gradient sweep (`live-tool-shine`, `apps/web/src/index.css:489-516`). The sweep is gated on `prefers-reduced-motion: no-preference` and paused off-screen through `--visible-animation-state`. `LiveActivityRow`/`LiveActivityContent` build it (`MessagesTimeline.tsx:3162-3252`).
- **The only elapsed time is turn-level.** The `working` row at the top of the live turn reads `Working for 38s` (`WorkingTimelineRow`, `:2531-2564`). `WorkingTimer` rewrites its own `textContent` through a ref every second, so the tick never causes a React commit (`:2907-2932`). After the turn it becomes the `Worked for …` fold label (`formatDuration`, `packages/shared/src/orchestrationTiming.ts:14-31`).
- **Errors.**
  - **Routine tool failures** keep the row's own icon, tinted `text-tool-error-icon/40`, with `aria-label="… tool call failed"`. Icons that can't take a tint get a trailing `XIcon` (`:3151-3160`, `:4888-4892`).
  - **Severe failures** get destructive text and a `circle-alert` icon (`runtime.error`, `*.failed` activity kinds; `:4754-4813`).
  - **Heuristics on output text.** Failure is also inferred from output text ("command not found", "No such file", `exit code N`; `toolDetailTextLooksLikeFailure`, `presentation.ts:397-416`), because "Some providers report completion even when the output describes a failure".
  - **Failures break runs.** A failure ends the live run, and failed trailing rows never fold.
- **Approvals live in the composer.** `ComposerPendingApprovalPanel` renders inside `ChatComposer.tsx:6218`. In the transcript, approval activities show up only as "Received N updates" inside a group summary.

### A.5 Verbosity setting

**There is none.** `ClientSettingsSchema` (`packages/contracts/src/settings.ts:298-495`) has no transcript, tool-detail, or reasoning-visibility key. The nearest settings are `chatWidth` and the server-side `responseStreamingMode` (`turn | paragraph | token`; `settings.ts:1112-1114`, labels in `apps/web/src/components/settings/SettingsPanels.tsx:182-193`), which controls how text streams in, not how dense tool rows are. t3code has one fixed compact presentation. Verbosity comes from click-to-expand at three levels: turn fold → group → entry.

### A.6 Row anatomy

- **Row layout:** `flex min-h-6 items-center gap-1.5 rounded-md px-0.5 py-0.5 text-sm leading-relaxed`. The icon sits in a `size-6` box with a `size-4` lucide icon and `text-icon-muted`. The label is `min-w-0 flex-1 truncate text-secondary-label`. On the right are a hover-revealed timestamp (`TimelineRowTimestamp`, `text-xs text-muted-foreground tabular-nums`, `opacity-0` until row hover or focus; `:2327-2353`) and a `ChevronRight` (`size-3 opacity-70`) that rotates 90° when open (`PlainWorkEntryRow`, `:4834-4909`; `WorkGroupToggleTimelineRow`, `:3342-3370`). The row has no card frame or border, and hover shows `bg-accent/20`.
- **Icons by action** (`toolGroupSummaryIconName`, `:3305-3340`):
  - read → `eye`
  - edit → `square-pen`
  - command → `terminal`
  - web search → `globe`
  - code search → `search`
  - subagent → `bot`
  - other → `wrench`
  - mixed and dynamic → `hammer`
  - thinking → `brain`

  Tools that bring their own favicon or app logo render it instead (`ToolActivityIconView`).
- **Expanded body:** `ms-7 rounded-md bg-muted/40 px-3 py-2`, with a mono `<pre>` inside (`text-2xs`, `max-h-64 overflow-auto`, selectable; `:4461-4462`, `:4930-4937`).
- **Fold and working rows** are full-width lines with `border-b border-border/60` and muted `tabular-nums` text (`:2360`, `:2549`).

### A.7 Borrow / skip for Mainframe

This is measured against Part 3 and the decisions already taken: per-step rows, one global setting, and thinking shown as "Thought for Ns" rows.

**Borrow**

1. **The shell-unwrapping approach and its test corpus.** `commandLabel.test.ts` is a ready-made table for `classify-bash.ts` step 1 (§3.4): `zsh -lc` / `bash --noprofile --norc -l -c` wrappers, `env -u`/`sudo -u`, Windows paths, and heredocs. The rule "builtins and control flow → generic 'command', never 'Ran if'" should also be copied. Run the intent table (lint/test/…) on the unwrapped program, not on the raw string.
2. **"Running <program>" as the unknown-intent label while running.** This is a better running-state fallback than a truncated raw command. Keep §3.4's `args.description` → raw-command fallback for completed rows. That matches t3code, which shows the raw command once a call completes.
3. **A verb tuple per kind** (`[action, running, completed]` plus derived `Failed to …` / `Declined to …` / `Stopped …`). It gives one table that produces present tense, past tense, and failure wording for the §3.4 labels without branching per kind.
4. **A self-ticking timer that writes `textContent` through a ref** (`WorkingTimer`). Use it for per-row elapsed time and the live "Thinking 12s" counter so long transcripts don't commit every second. Pause animations off-screen, as `--visible-animation-state` does.
5. **Two failure tiers:** a tinted icon plus `aria-label` for routine tool errors, and destructive text only for turn and runtime errors. This refines §3.5's single "error" treatment. The "failure breaks the run" rule matches §3.4 rule 2.
6. **Disclosure state at thread level, keyed by stable id** (`toolCallId`, not row index), outside the row component. Rows then keep their expansion across remounts and virtualization, which is stronger than §3.6's in-block state.
7. **Bounded expansion.** Cap an expanded body's height and scroll inside it (`max-h-64`) so opening one noisy Bash row can't push the whole transcript around. This complements `useScrollLock`.
8. **Answered and decision rows never fold.** t3code keeps answered questions and subagent-spawn rows visible after folding. This is the same idea as `PINNED_TOOLS` and confirms it.

**Skip**

1. **Mixed-count group summaries** ("Read 3 files, changed 2 files, and ran 4 commands"). These conflict with the per-step-rows decision. They throw away file names and per-step status, so they're a lossy fallback, not a target.
2. **Server-side substring classification of tool names.** It sends Claude's `Read`/`Grep`/`Glob` into `dynamic_tool_call`, labels them with raw `Read: {json}`, and counts them as "used N tools". Mainframe's tool-name-keyed summarizer (§3.4, which covers both adapters because Codex already maps onto Claude names) is strictly better.
3. **Guessing failure from output text.** Mainframe has `isError` from both adapters (§2.3). Don't grep stdout for "command not found".
4. **Hiding "neutral" rows** (tool-like with neither success nor failure) in settled groups (`workEntryIsVisibleInGroup`). It can silently drop calls that never reported a result, which is exactly the empty-output Bash case in Uncertainties.
5. **A settings-free design.** t3code gets by with one mode because every row expands inline. Mainframe keeps verbose as the default for its e2e contract (§2.6), so it still needs the global setting. t3code offers no pattern to copy for it.
6. **Unlabelled "Thought" rows.** t3code shows no reasoning duration. Mainframe's "Thought for Ns" needs the per-part timing from §3.5, and t3code doesn't have that either. The one thing worth taking from its thought rows is the single-line, markdown-flattened **preview** of a collapsed thought (`remarkThoughtPreview`), as an optional secondary text.

**Consider later (not v1)**

- **A "Worked for Xm Ys" fold for settled turns.** It hides everything before the final answer once the turn ends, keeps live turns unfolded, and keeps failures and decision rows outside the fold. It sits on top of per-step rows as an extra density level. It needs a turn duration, and the running footer already computes one (`use-run-elapsed.ts`). Reconsider after compact rows ship.
- **The single live row.** During a live run, only the latest step shows, and a click expands the rest. This conflicts with per-step rows while the turn runs, but it's worth an A/B if long Codex runs still scroll too fast in compact mode.
- **Codex `commandActions`.** t3code ignores them too, so §3.4's Codex upgrade goes beyond anything t3code does, not behind it.
