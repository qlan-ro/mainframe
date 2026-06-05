# ADR: Chat runtime for `app-tauri`

**Status:** Accepted · **Date:** 2026-06-05 · **Branch:** `feat/app-tauri-wt`

## Decision

The `app-tauri` chat UI uses **`useExternalStoreRuntime`** (assistant-ui), fed by a **per-chat subscriber over the existing daemon WebSocket**. The daemon remains the single source of truth; the UI keeps **no app-side message cache**. `convertMessage` (DisplayMessage → assistant-ui ThreadMessage) moves into a **shared core view-model**. Permissions and queued messages render as **sibling chrome** driven by WS events, not as message parts.

We do **not** adopt `useAssistantTransportRuntime`, and we do **not** make the daemon a "native assistant-stream backend" now.

## Context

The user's goals: the daemon owns conversation state (it already does), the UI is a thin consumer, and — critically — **no Zustand cache holding the message history** (the current desktop's `useChatsStore.messages` drifted from the daemon and caused real bugs).

Three research rounds (installed `@assistant-ui/react@0.14.5` source + GitHub HEAD `0.14.14`) — *app-tauri is now pinned at `0.14.14` / `core 0.2.10`; the decision was re-verified there*:

- **`useAssistantTransportRuntime` is `@alpha`, under `legacy-runtime/`**, and is **built on top of `useExternalStoreRuntime`**, keeping state in an internal `agentStateRef` — so it does **not** remove the UI store; it hides one inside an experimental runtime.
- Its model (single client, POST-per-run, client-uploads-state) **inverts** the daemon (server-owned state, persistent WS push, multi-client broadcast). It has **no post-run fan-out** to passive subscribers and **no native server→client permission channel**, so the WS broadcast (and the mobile-co-owned contract) would be needed anyway → two protocols.
- `assistant-stream` (the wire format) is stable, but adopting the native path is high daemon cost + a mobile-contract break for **no** additional store-less-ness.
- The new tap-only `ExternalThread` client is **not shipping** in installed `@assistant-ui/store@0.2.10` (the ready-made resource elements aren't exported); a **custom RuntimeCore is an internal, churning API** — both rejected for a new app's core.
- `useExternalStoreRuntime` is **stable** (no `@alpha`/`@deprecated`; only the threadList sub-adapter is deprecated — which we avoid by mounting one runtime per active chat).

Key correction: **"external store" ≠ Zustand.** A per-chat `useSyncExternalStore` over the WS satisfies the contract with no app-managed cache — *less* UI state than the current desktop.

## Design: snapshot-authoritative, no message cache

> **⚠ SUPERSEDED** by the "Update — react-opencode reference" section below: drift is handled by **refetch-on-gap** (client-side, no daemon `seq`, no WS-contract change). The versioned-snapshot/monotonic-version design in this section + the Risks below are **kept for history only** — do not implement them.

- Messages live **only** in a per-chat subscriber, created on open and **torn down on switch**. No global/persistent message store.
- The daemon's server-built display list (`prepareMessagesForClient` → `display.messages.set`) is **ground truth**; the UI renders it and never re-runs the pipeline.
- **Versioned snapshots** (the drift-killer): the daemon stamps a **monotonic per-chat version**; the client applies in-order deltas during a turn and takes a **full authoritative set on subscribe / reconnect / detected gap**. A full set always wins and resets the version. Out-of-order/stale deltas are discarded.
- `isRunning` flows from the daemon straight to `thread.isRunning`.
- Optimistic send via assistant-ui `onNew` (transient), **dedup-by-id** when the daemon's snapshot echoes it.

## Risks (and mitigations)

1. **Full-snapshot cost on long chats** — don't full-resend every boundary; versioned snapshots (full set only on subscribe/reconnect/gap, in-order deltas otherwise).
2. **In-flight is structured, not just text** (tool calls, subagents, mid-turn permissions) — monotonic versioning; gap → resync, so structured deltas can't silently drift.
3. **Stale-delta-after-set race** reintroduces the old drift — requires the monotonic version/sequence to discard stale deltas. ("set wins" alone is insufficient.)
4. **Optimistic send vs zero cache** — a tiny *transient* optimistic message is unavoidable for snappy input; dedup-by-id on echo.
5. **assistant-ui tolerance of wholesale array replacement** (scroll, open tool cards, edit state, Monaco/Shiki re-render churn) — **must be validated in the prototype**.
6. **Mobile-co-owned WS contract** — any change to daemon emission cadence/versioning must be **additive** (don't break events mobile consumes); verify mobile's consumption first.

Meta: "no UI cache + snapshot-authoritative" is a small **bespoke state-sync protocol** (versioning, authoritative sets, reconciliation, dedup) — real discipline, not "set wins for free."

## Prototype scope (must stress, not just demo)

A long chat · a turn with a **nested subagent + a mid-turn permission** · a **reconnect mid-stream** · **optimistic send + echo dedup** · **two windows on one chat**. Drift-free + snappy under those → design proven.

## Consequences / follow-ups

- Pin all `@assistant-ui/*` sub-packages as a set (react/core/store/tap/assistant-stream) — independently versioned, several sub-1.0.
- Lift `convert-message.ts` into core, preserving the WS14c dual re-encode, the `\0` permission sentinel, per-message `uniqueId()` dedup, ≥1-content-part fallback, and `getExternalStoreMessages` recovery.
- ~~Daemon: add monotonic per-chat snapshot versioning~~ — **superseded** (see Update below): drift is handled client-side via refetch-on-gap, so no WS-contract change is needed. Keep the WS broadcast.
- A native `assistant-stream` endpoint stays an **optional, additive, Rust-era** surface — never a replacement for the WS.

---

## Update — `@assistant-ui/react-opencode` reference (2026-06-05)

assistant-ui ships an official adapter for a stateful CLI coding agent — **`@assistant-ui/react-opencode`** (HEAD; flagged experimental, but the *supported* pattern). It is the canonical blueprint for our case and **validates this ADR**: it is built on **`useExternalStoreRuntime`** (not AssistantTransport), with **`useRemoteThreadListRuntime`** for the session list. We mirror its structure — we can't reuse the package (it's bound to `@opencode-ai/sdk`).

### Architecture to mirror (react-opencode → app-tauri)
- **One shared event source** (`OpenCodeEventSource` → our `lib/daemon/ws-client`) + a **per-session controller** holding state via a **pure reducer over server events** (`OpenCodeThreadController` + `reduceOpenCodeThreadState` → our per-chat controller/reducer), exposed via `useSyncExternalStore`, **projected** to ThreadMessages (`openCodeMessageProjection` → our `convertMessage`), fed to `useExternalStoreRuntime`.
- **`extras`** on the runtime carries all non-message state + actions — permissions, ask-a-question, queued, worktree, cancel/interrupt/fork — surfaced via `useAuiState(s => s.thread.extras)` and dedicated hooks. **No separate store.** (This replaces "sibling chrome via WS-fed slices" with the assistant-ui-blessed `extras` mechanism.)
- **Sessions list = `useRemoteThreadListRuntime`** + an adapter over the **chats REST** (`list / create(initialize) / rename / archive / unarchive / delete / fetch`). **Now in scope** — supersedes the earlier "bespoke sessions list / avoid the threadList adapter."

### Drift — superseded (no daemon `seq`, no contract change)
react-opencode is also unversioned and handles drift **client-side**: only `text`/`reasoning` deltas are merged incrementally (`isSupportedDelta`); **any delta referencing an unknown message/part triggers a full `refresh()`** (refetch history). We adopt the same **refetch-on-gap** + REST-seed-on-(re)connect. This **removes the mobile-co-owned WS-contract change** — risk #3 is mitigated without `seq`. (`seq` stays an optional future optimization, not a requirement.)

### Optimistic send + dedup
Insert a local `pendingUserMessage` on send; reconcile against the server echo by **fingerprint** (normalized text + a time window) — mirror `findPendingMatchByHistory` / `shadowParts`.

### Revised Phase 2
1. Restructure the chat adapter to the **controller/reducer + projection + `extras`** shape (evolve Phase 1's simpler spine).
2. **`useRemoteThreadListRuntime`** for the sessions sidebar (chats-REST adapter).
3. **Permissions + ask-a-question + queued** via `extras` + hooks; reply over WS/REST.
4. **Refetch-on-gap** reconcile (incremental merge limited to text/reasoning).
5. **Optimistic send + fingerprint dedup.**
6. **Native tool rendering** — `convert-message` projects flat groupable tool-calls + a Task tool-call carrying `messages`; render via `GroupedParts` + `groupPartByType` + `tools.by_name` + `MessagePartPrimitive.Messages`; shadcn styling. (Replaces the synthetic `_ToolGroup/_TaskGroup/_TaskProgress` encoding — the go-native decision.)
7. **Two-windows-on-one-chat** test.

### Maturity note
react-opencode rides `useRemoteThreadListRuntime` / `useAuiState` / `useExternalStoreRuntime` — the "supported but evolving" surface. Pin all `@assistant-ui/*` as a set; this is the same path assistant-ui's own official adapter uses, so materially lower risk than AssistantTransport's `@alpha`.
