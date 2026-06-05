# Native tool-rendering seams (and how clean they really are)

**Date:** 2026-06-05 · **Branch:** `feat/app-tauri-wt` · **Status:** ✅ DECIDED + IMPLEMENTED (both seams removed)

> **Resolution (2026-06-05).** Both seams were removed before the card fan-out:
> - **Seam 1 → native.** `card-types.ts` (`ChatToolCardProps`) deleted. Cards are native `ToolCallMessagePartComponent`; the dispatch is `<Card {...part} />`; the registry is `Record<string, ToolCallMessagePartComponent>`.
> - **Seam 2 → daemon-authoritative.** The `GROUPABLE_TOOL_NAMES` list and the `indices<=1` unwrap are gone. `convert-message` records `{toolCallId→groupId}` in `message.metadata.custom.mainframe.partGroups` (top-level + each subagent transcript); `makeChatGroupBy(partGroups)` echoes it; `AssistantMessage` reads the metadata and memoizes the `groupBy`.
>
> The narrative below is kept as the rationale.

While building the native tool-rendering leaf (GroupedParts + tool cards) two seams looked like workarounds. This doc records what they are, *why* the framework forces a choice, what's actually clean, and the recommended fix. Source: the cloned `@assistant-ui/react@0.14.14` (`/tmp/assistant-ui`) — read directly, with file:line.

## The structural tension (framework-level, acknowledged by assistant-ui)

assistant-ui gives you **two** ways to render message parts, and they don't compose:

| | grouping (explore runs, chain-of-thought) | per-tool dispatch + native props |
|---|---|---|
| `MessagePrimitive.Parts` `tools={{by_name, Fallback}}` | ❌ (its `components.ToolGroup` is `@deprecated`) | ✅ clean, non-deprecated |
| `MessagePrimitive.GroupedParts` (render-prop) | ✅ | manual — you dispatch in the switch |

So if you want **grouping** (we do — the explore ToolGroup), you must use `GroupedParts`, which has **no `by_name` registry** — you dispatch tools yourself in the render-prop switch.

The only "pure tool-UI registry" that feeds `GroupedParts` (`part.toolUI`) is **`useAssistantToolUI`**, which is **`@deprecated`** (`core/src/react/model-context/useAssistantToolUI.ts:7-10,32-37` → migrate to a toolkit `render` or `Parts` inline overrides). The non-deprecated **toolkit** (`defineToolkit`/`Tools`) is built for *model-callable* tools (`execute`/`parameters`/model-context injection) — overloaded and **inert under our external-store runtime**; a poor fit for display-only daemon tools.

**Net:** GroupedParts + manual switch dispatch is the idiomatic path for our case. The **official `@assistant-ui/react-opencode` example does exactly this** (`examples/with-opencode/components/assistant-ui/thread.tsx:70-106`: a `renderOpenCodeTool` switch on `part.toolName`, no registry). This is our blueprint — so it is *not* a workaround; it's the supported pattern for a stateful CLI agent.

## Seam 1 — card prop type ✅ RESOLVED (was a false premise)

**The worry:** our cards used a custom `ChatToolCardProps` instead of the native `ToolCallMessagePartProps`, because `EnrichedPartState` (the part `GroupedParts` hands the switch) seemed to lack `addResult`/`resume`/`respondToApproval`.

**The fact:** it does **not** lack them. `EnrichedPartState` for a tool-call is `Extract<PartState,{type:'tool-call'}> & { toolUI, addResult, resume, respondToApproval }` (`core/src/react/primitives/message/MessageParts.tsx:659-668`, built at `:715-718`). So `<Card {...part} />` against a **native `ToolCallMessagePartComponent`** typechecks — confirmed by the opencode example (`<ReadTool {...part} />` with `ToolCallMessagePartComponent`-typed tools, `thread.tsx:70-106`).

**Decision:** drop `ChatToolCardProps`; cards are native `ToolCallMessagePartComponent`. Strictly cleaner, matches the blueprint, and interactive cards (AskUserQuestion, future permission gates) get the native `addResult`/`respondToApproval` for free. `part.messages` (subagent transcript) is also native on the part.

## Seam 2 — custom `groupBy` ⚠️ legitimate mechanism, one smell to fix

**The worry:** we wrote a custom `groupBy` (`group-parts.ts`) instead of the native `groupPartByType` helper, because standalone-tool detection (`groupPartByType`'s `'standalone-tool-call'` key) reads the **tool-UI registry's** `standalone` flag (`core/src/react/utils/groupParts.ts:85-100`) — which is empty since we (rightly) don't use the deprecated `useAssistantToolUI`.

**The fact:** `GroupedParts` takes an arbitrary `groupBy` by design; `groupPartByType` is just a helper for the common case. opencode uses the helper only because it has **no standalone tools** (everything groups into chain-of-thought). We have standalone tools (Edit/Write/Bash/Task float onto their own line), so a custom `groupBy` is the intended extension — not a workaround.

**The smell:** our `groupBy` hardcodes `GROUPABLE_TOOL_NAMES = {Read,Grep,Glob,LS,NotebookRead}`, duplicating the daemon's **adapter-declared** `categories.explore` (`core/src/messages/tool-categorization.ts`). One adapter today (Claude), but this drifts the moment a second adapter (Codex/Gemini) declares a different explore set, or Claude adds an explore tool.

**The root cause:** the daemon **already computes the grouping** (it emits `tool_group` from `categories.explore`); flattening it and re-deriving the grouping client-side from tool *names* is reconstructing a decision the server already made — a heuristic standing in for ground truth. opencode re-derives because *its* server streams flat parts; **ours does not**.

**The clean fix — make `groupBy` echo the daemon's grouping, don't re-derive it.** convert-message *structurally* knows which tool-calls came from a `tool_group` (it's flattening them) vs. a standalone `tool_call`. So it records that membership and `groupBy` just reads it:
- convert-message assigns each flattened `tool_group` a `groupId` and records `{ toolCallId → groupId }` (only for grouped tools) on the message — standalone tools (incl. a *lone* explore tool, which the daemon never groups) get nothing.
- `groupBy(part)` = `tool-call with a recorded groupId → ['group-tool-'+groupId]` · `reasoning → ['group-reasoning']` · else `[]`. Adjacency coalescing reconstructs **exactly** the daemon's groups (group members are contiguous; standalone tools separate groups).

Benefits: no name-list, no category heuristic, daemon-authoritative across all adapters, and it **deletes the `indices<=1` unwrap hack** (a lone explore tool is already standalone server-side → renders bare). Carry mechanism (where the `{toolCallId→groupId}` map lives) — pick one:
- **(A) `message.metadata.custom.mainframe.partGroups`** (recommended). A documented metadata slot; `AssistantMessage` reads it via `useAuiState(s=>s.message.metadata)` and builds a `useMemo`'d closure `groupBy`. Type-safe, won't be stripped. Cost: a per-message memoized `groupBy` (cheap tree rebuild).
- **(B) a field on the part** (`__mfGroup`), surviving `fromThreadMessageLike` via the `...basePart` passthrough (`core/src/runtime/utils/thread-message-like.ts:167-173`). Lets `groupBy` stay module-level (best memo), but relies on (undocumented) extra-field passthrough + a cast.

## What changes if we adopt the above

1. Delete `card-types.ts` (`ChatToolCardProps`); cards become native `ToolCallMessagePartComponent`; dispatch is `<Card {...part} />` (registry → `Record<string, ToolCallMessagePartComponent>`).
2. `convert-message`/`map-assistant-blocks` record `{toolCallId→groupId}` per message (top-level + each subagent transcript) via the chosen carry slot.
3. `group-parts.ts` `groupBy` reads the recorded membership instead of `GROUPABLE_TOOL_NAMES`; the `indices<=1` unwrap in `tool-dispatch.tsx` is removed.
4. Everything else (GroupedParts switch, ToolGroup summary, Task `messages`, ToolFallback catch-all) is unchanged.

This keeps the locked "go native (GroupedParts)" decision, makes grouping **server-authoritative** (no client heuristic), and removes both smells — without reverting to the daemon-side `_ToolGroup` synthetic part (whose nested tools couldn't be native cards).
