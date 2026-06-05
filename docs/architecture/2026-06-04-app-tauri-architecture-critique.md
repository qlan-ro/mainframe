# `app-tauri` Architecture — Plan Critique (pre-scaffold)

**Date:** 2026-06-04 · 6 adversarial lenses + a devil's-advocate completeness pass, grounded in the real `packages/desktop` code.

**Overall:** the folder *shape* (feature-first, drop-the-zone-system, single Tauri bridge, god-file decomposition) is sound. But several **headline claims and seams are wrong or underspecified**, and the riskiest integrations are deferred behind weeks of safe UI work. Do **not** scaffold until the items below are resolved and the risk-first spikes pass. *(Historical: the risk-first spikes — esp. C1 — have since passed and execution has begun; see `MIGRATION-TRACKER.md` for live status.)*

> **⚠ Some recommendations below were SUPERSEDED by the 2026-06-05 decisions** (see `2026-06-05-chat-runtime-decision.md`, `ASSISTANT-UI-INVENTORY.md`, `MIGRATION-TRACKER.md`): the sessions list is a **hybrid** (one global `useRemoteThreadListRuntime` + native `ThreadListItemPrimitive` rows in our grouped sidebar), **not** "declare it fully custom"; tool/subagent rendering is **native `tools.by_name` + `GroupedParts` + `MessagePartPrimitive.Messages` via the `convert-message` projection**, **not** "make `renderToolCard` canonical"; and the `convert-message` sentinel/dual-encoding invariants are **load-bearing (keep them)** — the spike verifies the nested payload is rich enough for native projection *while preserving* those invariants, not whether they can be dropped. **Also: the runtime is `useExternalStoreRuntime`, NOT `useAssistantTransportRuntime`** — any critique item framing "AssistantTransport" as the wire contract or client runtime is resolved → ExternalStore (see the ADR). Read the points below with those corrections in mind.

---

## Critical risks (ranked)

### C1 — Sidecar runtime *environment*, not just packaging (the scariest, and nobody but the completeness pass named it)
The daemon's core job is to **spawn agent CLIs + LSP servers as child processes**. Today that only works because Electron forks it with the user's **login-shell environment** (PATH, etc.). A Tauri sidecar launched from a Finder-double-clicked app gets a **bare environment** → agents fail to spawn **for real users**, while every dev spike and the e2e-mock pass (they have a shell env). Silent death of the core function.
Also: packaging was scoped to `better-sqlite3` only — the daemon also drags **ripgrep, pyright, tsls** binaries and has **no bundled Node runtime** under Tauri.
**Fix:** Spike "real agent spawns from a packaged, Finder-launched build" before anything else; design env propagation + bundle the native deps + a Node runtime (or compile the daemon).

### C2 — The "frozen contract" is mislabeled (this is your daemon-seam question, answered)
AssistantTransport is a **request-scoped POST→SSE state-streaming protocol for a single thread**. The real daemon is a **persistent WS bus + REST** with ~50 event types across chat/files/launch/plugins/tunnel/LSP (separate socket)/process lifecycle — and terminal lives *outside* the daemon. The current chat layer is `useExternalStoreRuntime` + `convertMessage` over `DisplayMessage[]`, **not** transport snapshots.
**So:** the genuine frozen contract is the **existing typed WS+REST schema in `mainframe-types`** (which the **mobile submodule co-owns**), *not* the assistant-ui runtime. AssistantTransport is a **client-side runtime choice over that contract** — it does **not** by itself de-risk the Rust swap.
**Fix:** make `lib/daemon/` the **top-level seam**; demote `features/chat/runtime/` to a chat-slice consumer. Decide explicitly: is AssistantTransport the **wire contract** (then spec a Rust-implementable schema now) or **just a client runtime** over the existing WS contract (then stop claiming it frees the Rust swap)? Write a **Frozen Contract Inventory** (chat events, REST envelope, LSP JSON-RPC socket, file-subscription, auth/tunnel) with a conformance test against both daemons; mark terminal out-of-contract.

### C3 — "No feature knows about the surface engine" is contradicted by real behavior
Chat tool cards open file/diff views today via `useTabsStore.getState().openInlineDiffTab/openEditorTab/revealFileInTree` (verified in `EditFileCard`, `WriteFileCard`, `shared.tsx`). Under by-arrival placement, "open this diff" must materialize a Files surface — i.e. a feature must trigger the layout engine. The plan gives no mechanism.
**Fix:** a **one-way surface-intent bus** — features *emit* intents (`open({kind:'files', target})`); only `layout/` subscribes and places. Forbid `features/** → layout/**` imports with a dependency-cruiser/ESLint rule (enforced, not asserted).

### C4 — State ownership: dual-writer collision
AssistantTransport holds its own messages/isRunning/optimistic state (it's built on ExternalStore) **and** the plan proposes a Zustand `chats → messages/process/permission` split — two writers over today's WS-router→Zustand pipeline. Also, physically splitting `useChatsStore` breaks the **atomic** `removeChat`/`setActiveChat` transactions.
**Fix:** declare the runtime the **sole owner** of active-thread message/running/permission state; reduce the Zustand `chats` store to **cross-chat list/metadata only**; if sub-state stays, use **one composed store with slice factories**, not separate stores. Re-verify the permission-queue ownership so the documented swallowed-permission bug can't return.

### C5 — assistant-ui reality checks (your "use it fully" goal, bounded by what the daemon can drive)
- The **session list is not `ThreadList`** — mainframe's per-session **process + worktree** model doesn't fit ThreadList's one-thread-with-branches. Declare it custom.
- "**One `makeAssistantToolUI` registry incl. nested task groups**" is impossible — nested subagent children aren't message parts. Make **`renderToolCard` canonical** (a recursion), unify *toward* it.
- The `convert-message` sentinel/dual-encoding hacks **don't vanish under AssistantTransport** — they encode daemon grouping + duplicate-key/permission/error constraints. They only move if relocated into a **core view-model**. State that.
- **Branching / edit / reload / reasoning** are assistant-ui features the `--resume` CLI daemon **cannot drive** — explicitly scope them out (or build daemon support deliberately).

### C6 — Tauri: reverse two "hard-way" defaults
- **Rust PTY from scratch** was chosen over the cheaper, contract-preserving option of **adding PTY endpoints to the daemon** (which becomes Rust in Phase 2 anyway). Reverse the default → terminal in the daemon.
- **`<webview>` preview → "iframe"** is hand-waved; an iframe **can't screenshot, inject inspect scripts, or isolate sessions** (all things `PluginView` does). Decide v1 scope explicitly.
- `capabilities/`/CSP is an empty folder — a **new privileged trust boundary** (readFile allowlist, `openExternal`/`showItemInFolder` injection vectors) the project's own security rules must govern. Spec per-command.
- Webview-engine gaps flagged but not designed: **CSS Custom Highlight API** (FindBar) on WKWebView, **Monaco workers + Shiki dynamic import** under the Tauri asset protocol — each can silently break Chat/Files.

### C7 — Boundary rules are fuzzy where it matters
- **`surfaces/` vs `layout/`**: both own composition. Litmus: `layout/` = generic engine (host, rail, by-arrival, persistence), zero feature knowledge; `surfaces/<name>/` = surface-specific composition (which features render in Files + how they tab/split). Decide where Files-surface tab/nav state lives (not a generic store features reach into).
- **"Pure logic → core" conflates a sidecar *process* with a compile-time *import*.** The renderer can't import the core sidecar's runtime functions. Create a **pure, bundleable shared package** (extend `mainframe-types` or new `@qlan-ro/mainframe-shared`) for renderer-importable helpers; "→ core" means *that*, not the process.
- **components/ vs features/ vs lib/**: the command palette + pickers are **domain-coupled** (sessions, file search, resumeChat, openChatTab) — not generic; the LSP client is a **daemon-seam** concern (lib/daemon), not `features/editor`. Write an import-direction tier rule.

### C8 — Missing whole-workstreams (deferred = sunk)
- The **130-spec Electron-bound e2e harness + 301 data-testids** — the only behavioral safety net for a rewrite this size — has **no Tauri migration story**.
- **Theming** reduced to a token-file split despite **4 runtime-switchable themes** + load-bearing Monaco/aui-md CSS + documented token traps.
- **Sidecar lifecycle + connection/CSP/endpoint bootstrap** is a one-line placeholder.
- **Phase 2 (full Rust rewrite of `mainframe-core`)** — re-deriving the entire reverse-engineered CLI protocol corpus — is the **largest workstream in the project, unscoped/unsized/unjustified**, yet shapes every Phase-1 constraint. Needs an explicit **go/no-go with sizing** — nobody asked whether it should exist.
- **Existing Electron app lifecycle**: parallel-maintenance tax, dual-instance contention over one **data dir + fixed port 31415**, lost prefs on a new webview origin, and **no parity definition-of-done**.

---

## Recommended re-sequencing: risk-first, spikes before UI

Build order currently front-loads safe shadcn/layout work and defers every make-or-break integration. Invert it. **Run these spikes before scaffolding:**

0. **Env spike** — a real agent **spawns from a packaged, Finder-launched Tauri build** with the Node daemon as a sidecar. (C1)
1. **Bootstrap spike** — bare Tauri shell → Node sidecar → "Connected" (CSP + endpoint + sidecar packaging incl. native deps). (C1/C8)
2. **Seam spike** — one real chat driven through the chosen runtime against the **live daemon**, exercising the **WS14c nested-subagent + permission + queued-message** case (proves whether convert-message hacks can drop and whether the contract holds). (C2/C5)
3. **e2e spike** — a Tauri e2e harness driving one smoke spec. (C8)

Only after these pass do tokens + shadcn `ui/` + layout work begin.

---

## Decisions to lock before scaffolding

1. AssistantTransport = **wire contract** (spec it now, Rust-implementable) **or** **client-runtime** over the existing WS schema? (recommend: client-runtime; the WS/REST schema in `mainframe-types` is the real frozen contract)
2. Terminal: **daemon endpoints** (recommend) vs from-scratch Rust PTY?
3. Preview: iframe vs embedded webview vs Tauri window — what's v1?
4. Shared pure-logic home: extend `mainframe-types` vs new `@qlan-ro/mainframe-shared`?
5. Phase 2 Rust daemon: explicit **go/no-go + sizing** — is it even worth it given C1/C2?
6. Electron app: retire, coexist (port/data-dir/prefs plan), or feature-flag cutover? Parity definition-of-done?
7. Mobile co-owns the WS contract — governance rule for changing it.
