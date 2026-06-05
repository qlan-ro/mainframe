# `@qlan-ro/mainframe-app-tauri`

The new **Tauri 2 + React** desktop UI — a *parallel* rebuild of `packages/desktop` (Electron), not a modification of it. Treat `desktop/` as **reference only** (behavior + the visual target); never edit it from here.

> **New here? Read `docs/architecture/MIGRATION-INDEX.md` first** — it catalogs every doc, the vendored design spec (`docs/design-reference/`), and the flow. Then the root `CLAUDE.md` (monorepo code rules), the runtime ADR (`2026-06-05-chat-runtime-decision.md`), the tracker (`MIGRATION-TRACKER.md`), and the architecture/critique docs.

---

## ⭐ Golden rule: chat/thread/thread-list components — assistant-ui first, **stop-and-ask on mismatch**

For **any chat / thread / thread-list / message / tool-card / permission / composer component**, follow this process — never skip it:

1. **Research** what assistant-ui provides for it (check the *installed source*, not just the docs — they drift).
2. **Compare** it to our warm-chrome prototype design (the relevant artboard).
3. **If it matches** → use the assistant-ui component, **restyled** to the design. Do not rebuild what it provides.
4. **If it does NOT match** → **STOP. Build neither version yet.** Present a concise **side-by-side summary — our design vs the native assistant-ui component** (what each offers, where they diverge, the cost of each direction) and **ask for a decision.**

Never silently (a) rebuild what assistant-ui already provides, nor (b) force a native component that doesn't fit the design — a mismatch is a **human decision**. *(Subagents can't prompt the user: on a mismatch, STOP, build nothing, and return the design-vs-native summary to the orchestrator, who asks.)*

The per-area pointers below are where to look in step 1:

- **Tool cards → MATCH (use the engine wholesale, restyle).** `MessagePrimitive.GroupedParts` + `tools.by_name`/`Fallback`; restyle the shadcn `ToolFallback`/`ToolGroup` compounds; subagent transcripts via `MessagePartPrimitive.Messages` (+ `ReadonlyThreadProvider`); per-arg streaming via `useToolArgsStatus`. Build per-family cards (Edit/Write/Bash/Read/Grep/Todo/Web/MCP/Plan/Skill/Worktree/Schedule) as `tools.by_name` entries, `ToolFallback` as the catch-all. **DROP** `makeAssistantToolUI` (deprecated) → one `tools.by_name` map (`ToolFallback` = catch-all). **DECIDED: go native** — `GroupedParts` + `groupPartByType` + `display:'standalone'` for tool grouping; `part.messages` (+ `ReadonlyThreadProvider`) for subagent/Task transcripts. **Preferred path = do it in the projection:** `convert-message` maps the daemon's *existing* nested encoding → native ThreadMessage parts (flat groupable tool-calls + a Task tool-call carrying `messages`), so **no daemon/mobile-contract change** if the nested payload is sufficient; daemon flat-parts is the fallback only if it isn't (verify at build). See `docs/architecture/ASSISTANT-UI-INVENTORY.md` #1/#2.
- **Permissions / ask / plan → NO native UI exists → custom shadcn cards (sibling chrome via `extras`).** The in-band `humanTool`/`approval` gate isn't usable under our external-store runtime (and our `control_request` is out-of-band anyway) — there is nothing native to adopt. Build 3 cards (port from desktop, re-skin) read via `useChatPermissions`/`useChatQuestions` over `extras`. Preserve the queue-front-only invariant; Always-Allow only when `suggestions.length>0`; **don't invent** risk levels/scopes/per-arg toggles.
- **Composer → MATCH (~90% native, restyle).** `ComposerPrimitive` Root/Input/Send/Cancel (`asChild`→our icon buttons, swap on `thread.isRunning` via `AuiIf`)/AddAttachment/AttachmentDropzone/Attachments/Quote. **Keep `QueuedMessageBanner` (daemon-backed); the native `Queue` is a different local model — do NOT use it.** Build the config toolbar (model/effort/features/plan/permission/worktree/captures) as **stateless** shadcn children that write `composer.setRunConfig({custom:{…}})` (Zod-validate daemon-side). `@`-mention via shadcn `Command` (native `Unstable_TriggerPopover` is @alpha); custom thumbnail (native `Thumb` is @alpha/extension-only). **Never `useComposer()`** (getSnapshot loop) — `useAuiState` + `useAui().composer()`.
- **Quote / select-to-quote → MATCH (use native).** `SelectionToolbar` (floating quote button on text selection — **replaces our `QuoteOnSelectionButton`**), `MessagePrimitive.Quote` + `QuoteBlock` (inline quote in the user message), `ComposerPrimitive.Quote/QuoteText/QuoteDismiss` + `ComposerQuotePreview` (composer pill). Install the shadcn `quote` component and restyle; don't re-implement selection/quote handling.
- **Sessions / thread-list → HYBRID (decided).** One global `useRemoteThreadListRuntime` (all sessions; domain data in thread `custom`: projectId/tags/prState/worktree/status/pinned) + native `ThreadListItemPrimitive` rows (rename/archive/delete/select/active) rendered inside **our** grouped/filtered/pinned sidebar layout via `ThreadListItemRuntimeProvider`/`ThreadListItemByIndexProvider`. NOT the flat default `ThreadListPrimitive.Items`; NOT per-project runtimes.
- **Markdown / reasoning / parts** → assistant-ui part components; restyle. **Reasoning: DECIDED — show the native `Reasoning` block, collapsed by default** (drop the dead `ThinkingPart`).

**Framing (don't repeat the over-conservative mistake):** the native *runtime-integration hooks* — `ModelContext.register`, `useThreadTokenUsage`, `useAssistantInstructions` — are **INERT under our external-store runtime** (they target the AI-SDK transport). But the native *presentational components* work fine. So the pattern is almost always **native component + our CLI/daemon data + our config-write path**, NOT "keep ours." e.g. `ModelSelector.Root` (composable, not the default export) fed our models; `ContextDisplay.Bar` with its external `usage` prop fed our CLI usage; `MessageTiming` fed `metadata.timing`; native `Image`/`File` parts fed `convert-message`; the `SyntaxHighlighter`/`CodeHeader` slots fed our shiki engine. Per-feature verdicts (6 adopt-native / 9 native-shell+our-data / 9 genuine keep-ours) live in `docs/architecture/ASSISTANT-UI-INVENTORY.md`.

*(Verified against `@assistant-ui/react@0.14.14` / `core@0.2.10`, 2026-06-05.)*

---

## Runtime & data
- **`useExternalStoreRuntime`** fed by a **per-chat controller** (the `react-opencode` shape: controller + pure reducer + `handle-daemon-event` + projection). **Not** AssistantTransport.
- **No app-side message cache.** The daemon is the single source of truth; the controller holds only the per-chat projection, disposed on switch. Drift is handled by **refetch-on-gap** (unknown-id delta → REST re-seed), not a client cache or a daemon `seq`.
- Sessions list via **`useRemoteThreadListRuntime`** + a chats-REST adapter.

## Architecture
- **Feature-first** under `features/`; `layout/` + `surfaces/` only *compose* features into the typed surfaces (Chat/Files/Run). No feature imports `layout/`.
- **Surface intent, not reach-through:** a feature that needs to open a file/diff/surface emits an intent; never `someStore.getState().openX()`.
- **`lib/tauri/` is the only Tauri-aware module** — all `window.mainframe.*` equivalents live there (Rust commands/events).
- **Pure logic** (convertMessage, diff math, file-types) goes in a shared bundleable location, **not** the `mainframe-core` *sidecar process*.

## Component layer & theme
- **shadcn/ui**, not raw Radix. Build the `components/ui/` primitives once; features compose them.
- Theme via `mainframe-theme.css` tokens. **Token traps:** never use the `/opacity` modifier on CSS-var colors; use only real `mf-*` token names.

## Conventions
- **No file > 300 lines**, no function > 50. Decompose god-files on port (don't carry them).
- **Every interactive element needs a stable `data-testid`** (`<surface>-<element>`); `ui/` primitives stay passthrough.
- **`convertMessage` invariants are load-bearing:** WS14c dual re-encode (top-level AND nested in task_group), the `\0` permission sentinel, per-message `uniqueId()` dedup, ≥1-content-part + error fallbacks.
- **Pin the whole `@assistant-ui/*` set together at the `react@0.14.14` / `core@0.2.10` line** (matches `react-opencode`'s `^0.14.14` peer; has `groupPartByType` + `display:'standalone'` + the `GroupedParts` `indicator` slot; fixes the `core@0.2.2`↔`store@0.2.10` skew). They're independently versioned and sub-1.0 — never let `^` ranges drift them apart.
- **Drop, don't port,** obsolete code: the `zone/` layout, layout/ui stores, the dual tool dispatcher, regex go-to-definition.

## Daemon contract
The WS/REST contract is **co-owned by the mobile submodule** — changes must be **additive** (mobile ignores unknown fields). No unilateral reshaping.

## Definition of done (per ported surface)
Typecheck + tests green · matches the prototype artboard (design-conformance) · passes the thermo-nuclear standards · data-testids preserved · no `getState()` reach-through · files < 300 lines · obsolete code dropped · tracker updated.
