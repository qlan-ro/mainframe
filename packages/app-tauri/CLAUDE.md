# `@qlan-ro/mainframe-app-tauri`

The new **Tauri 2 + React** desktop UI — a *parallel* rebuild of `packages/desktop` (Electron), not a modification of it. Treat `desktop/` as **reference only** (behavior + the visual target); never edit it from here.

> Read alongside the root `CLAUDE.md` (monorepo-wide code rules still apply) and the canonical docs:
> `docs/architecture/2026-06-04-app-tauri-architecture.md` · `…-critique.md` · `2026-06-05-chat-runtime-decision.md` · `MIGRATION-TRACKER.md`.

---

## ⭐ Golden rule: chat/thread/thread-list components — assistant-ui first, **stop-and-ask on mismatch**

For **any chat / thread / thread-list / message / tool-card / permission / composer component**, follow this process — never skip it:

1. **Research** what assistant-ui provides for it (check the *installed source*, not just the docs — they drift).
2. **Compare** it to our warm-chrome prototype design (the relevant artboard).
3. **If it matches** → use the assistant-ui component, **restyled** to the design. Do not rebuild what it provides.
4. **If it does NOT match** → **STOP. Build neither version yet.** Present a concise **side-by-side summary — our design vs the native assistant-ui component** (what each offers, where they diverge, the cost of each direction) and **ask for a decision.**

Never silently (a) rebuild what assistant-ui already provides, nor (b) force a native component that doesn't fit the design — a mismatch is a **human decision**. *(Subagents can't prompt the user: on a mismatch, STOP, build nothing, and return the design-vs-native summary to the orchestrator, who asks.)*

The per-area pointers below are where to look in step 1:

- **Tool cards** → `makeAssistantToolUI` + `MessagePrimitive.Parts` (`tools.by_name` / `Fallback` / `ToolGroup`). One registry; nested/subagent groups via `ToolGroup`. Don't build a parallel dispatcher.
- **Permissions / ask-a-question** → adapt assistant-ui's human-in-the-loop patterns (`humanTool` / approval / `addResult`) and surface state via the runtime's **`extras`** + hooks (`useChatPermissions`, etc.). Our `control_request` is out-of-band, so it's sibling chrome reading `extras` — but reuse assistant-ui's card/affordance primitives, don't invent them.
- **Composer** → `ComposerPrimitive` (Root/Input/Send/Cancel/Attachments) + `AttachmentPrimitive`; add our config controls (model/effort/features/plan/permission/worktree/captures) as custom shadcn controls *around* it.
- **Markdown / reasoning / parts** → assistant-ui part components; restyle, don't replace.

*(Concrete API mapping + the per-area match/mismatch verdicts come from the adoption-plan research — update this file as it's finalized.)*

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
- **Pin all `@assistant-ui/*` as a set** (react/core/store/tap/assistant-stream) — independently versioned, several sub-1.0.
- **Drop, don't port,** obsolete code: the `zone/` layout, layout/ui stores, the dual tool dispatcher, regex go-to-definition.

## Daemon contract
The WS/REST contract is **co-owned by the mobile submodule** — changes must be **additive** (mobile ignores unknown fields). No unilateral reshaping.

## Definition of done (per ported surface)
Typecheck + tests green · matches the prototype artboard (design-conformance) · passes the thermo-nuclear standards · data-testids preserved · no `getState()` reach-through · files < 300 lines · obsolete code dropped · tracker updated.
