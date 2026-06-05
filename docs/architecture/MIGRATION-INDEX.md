# app-tauri Migration — START HERE (agent onboarding)

If you're picking up the **desktop (Electron) → app-tauri (Tauri 2 + React)** migration in a fresh session, read this first. It catalogs every document, says what each is for and *when* to use it, and encodes the flow so you boot with near-parity context.

## Read in this order
1. **`packages/app-tauri/CLAUDE.md`** — the *rules* (auto-loaded when you work in the package). The ⭐ golden rule: for any chat/thread/thread-list/message/tool-card/permission/composer component → research what assistant-ui ships, compare to our design, **use+restyle if it matches, else STOP and ask** with a design-vs-native summary.
2. **This index** — the map.
3. **`MIGRATION-TRACKER.md`** — *what's left*: every surface with disposition (port/refactor/replace/drop) + status + target home. Update it as you land work.
4. **`2026-06-05-chat-runtime-decision.md`** (ADR, + the react-opencode update) — *the* runtime decision and why.
5. **`2026-06-04-app-tauri-architecture.md`** + **`-critique.md`** — target structure + the risks that shaped it.

## Resume here (session snapshot — 2026-06-05, end of COMPOSER + REVIEWS session)

**Phase: the COMPOSER leaf is built, plus a thermo-nuclear + an architecture review (the fixes for the thermo pass are landed).**

**Landed since the chat-surface snapshot (below):** the composer leaf — shell (Send↔Cancel swap, `ViewportFooter` scroll-inset), the full config toolbar (model · permission · plan · effort · features over REST `/config` + `/tuning`), queued messages (pending cards + composer edit mode), attachments (native `AttachmentAdapter` + shadcn attachment UI), the message timestamp, plus live spot-fixes (focus ring, hover layout-shift, Edit diff-icon, Bash "Run" drop). Then **the optimistic-send crash fix** (user messages must not carry `status`) and **the full thermo-nuclear review-fix batch**: `lib/api` `request<T>` collapse, controller seam (cancelQueued/editQueued via extras, port threading, live `isRunning`, toUploadItems→adapter, ComposerEditMode save-failure), dead-code/de-casts, the `makeUserMessage` typed factory, and **send/attachment/tuning tests (323 total, typecheck 0)**.

**Open work is captured in 3 handoffs in the OS temp dir (`/tmp`, volatile — if cleared, re-derive from the arch review + this index):**
- `handoff-permissions-ask-plan-cards.md` — the **next chat leaf** (3 custom shadcn cards over `extras`; the permission data+reply path is already wired).
- `handoff-features-chat-restructure.md` + `handoff-architecture-review.md` — the **architecture review** (`woyzow9sq`), fully handed off (no work started).

**Architecture-review CRITICALS to not lose (durable summary; full list in the arch handoff):** ① `ws-client.send()` silently drops frames when not OPEN + `replyToPermission` resolves before ack → permission hang. ② **`app-tauri/tsconfig.json` does NOT extend `tsconfig.base.json` → `noUncheckedIndexedAccess` is OFF package-wide.** ③ dead optimistic send-failure path (meta writes `pending`/`error`, nothing reads them → failed send looks sent). ④ WS event stream + user metadata enter unvalidated (no Zod). ⑤ 6× `s as unknown as {message}` casts (use `useMessage()`). The praised, **do-not-touch** part: the controller/reducer/projection data spine. Sequence the fixes type-first → content → UX → tests → **restructure last** (mechanical, moves-only).

---

## Decisions log (PRIOR snapshot — 2026-06-05, end of chat-surface session)

> ⚠️ Historical. The forward-looking "NEXT/GATED composer" plan that used to live here is **removed** — the composer leaf is DONE (see the current snapshot at top) and its "config toolbar is GATED / needs a data layer" framing was the **over-conservative mistake** (the daemon had `/config`+`/tuning`+`/adapters` all along; it was wiring, not a prerequisite). The **decisions below are still authoritative.**

**Chat-surface session commits on `feat/app-tauri-wt` (4):**
1. `15ee859e` **native tool-rendering leaf** — projection (`convert-message`/`map-assistant-blocks`/`map-tool-result`) + daemon-authoritative grouping + the 14-family card registry.
2. `a90d37b6` **message-shell + markdown leaf** — `AssistantMessage`/`UserMessage`/`SystemMessage`, markdown (`MarkdownText`+shiki), action-bar, timing, warm-chrome thread shell.
3. `33e52e41` **thermo-nuclear review-fixes** — shared `CollapsibleCardShell`+`resolveResultText`, one `MainframeMessageMeta` contract + `useMainframeMeta`, native **grouped reasoning**, rich `SkillLoadedCard` from the system message, native **DirectiveText** chips, markdown dedup.
4. `dd68f777` **design-conformance pass** — fixed 2 invisible-error blockers (`--mf-destructive-tint`), reasoning ghost-frame+shimmer, BashCard family tile, StatusDot labels, slash-pill tint, + ~16 token deltas.

All verified: typecheck 0, **290 tests**, empirical render vs `~/.mainframe_dev` (chat `1Musk9EUiUzGa9-z0QzF7`, 0 console errors). Earlier-phase commits (C1 spike, runtime ADR, Phase-1/2A seam, shadcn+theme, `@assistant-ui@0.14.14`, full doc set) still apply.

**Locked decisions (quick recall):** runtime = `useExternalStoreRuntime` + per-chat controller, no message cache, refetch-on-gap · assistant-ui **0.14.14 / core 0.2.10** · **go-native** part model via the projection · sessions = hybrid · reasoning = native collapsed · queue = **daemon-backed** · errors = text-routing · adoption split 6/9/9 (see `ASSISTANT-UI-INVENTORY.md`).

**New decisions THIS session (record, don't re-litigate):**
- Metadata = **one `MainframeMessageMeta`** under `metadata.custom.mainframe` + one `useMainframeMeta()` reader; one `toJsonArgs()` cast site (`view-model/content.ts`).
- Grouping = daemon-authoritative; **group summaries derived in the projection** (carried in metadata, not re-read at render).
- Reasoning = canonical **`group-reasoning`** + `ReasoningRoot/Trigger/Content/Text`, **ghost** variant, `defaultOpen={running}`. "Thought for Ns" is **gated on a daemon thinking-duration field** (shows "Reasoning" until then).
- Skill = rich `SkillLoadedCard` rendered by **`SystemMessage`** from `skillLoaded` metadata (dead `_SkillLoaded` assistant arm + registry entry removed).
- `@mention` inline = native `createDirectiveText` **Badge chip** (kept as an **approved upgrade** over the artboard's plain accent text).
- Scrollbar = **CSS thin scrollbar** on the native Viewport (radix `ScrollArea` via `asChild` does NOT bind to `ThreadPrimitive.Viewport` — left `overflow:visible`/unbounded, pushed composer off; reverted).
- **Mention picker (when built) = native `Unstable_TriggerPopover` + custom `Unstable_TriggerAdapter`** (sync adapter over async daemon path-search; gate on @alpha churn).
- Edit **sent** messages = runtime-gated (CLI-resume has no branches) → deferred; `MessageActionBar` ships **Copy + Export only**.

*(The "NEXT: composer" plan that was here is removed — composer + gates are DONE; for what's next/deferred see the current snapshot at top + the tracker's "Review follow-ups — DEFERRED" section.)*

**Still-open follow-ups (the rest resolved/superseded):** reasoning "Thought for Ns" daemon thinking-duration field · deferred user-message states (`UMCodeRef` editor code-ref, `UMInspectChip` sandbox-inspect, file-attachment chips) · runtime-gated edit-sent/Reload/BranchPicker · sidecar packaging · e2e harness + testids · Phase-2 Rust-daemon go/no-go · Electron lifecycle · shared-pure-package home for `convert-message`. *(Resolved: permission-card mount placement → inline at thread tail; PLAN bubble → PlanGate.)*

---

## Document catalog

### A. How to build (rules — obey these)
- `packages/app-tauri/CLAUDE.md` — golden rule (assistant-ui-first, stop-and-ask), runtime, architecture, conventions, daemon-contract, per-surface DoD.
- Root `CLAUDE.md` — monorepo-wide code rules (security, async, file-size, data-testids) still apply.

### B. State & plan
- `docs/architecture/MIGRATION-TRACKER.md` — the living checklist (folds in the 10-subsystem port analysis).
- `docs/architecture/ASSISTANT-UI-INVENTORY.md` — the use-native checklist: every assistant-ui primitive/UI/hook vs our re-impl, with retire/keep/decide verdicts + a ~110-row master table. Consult before building any chat surface.

### C. Decisions (the "why", locked)
- `docs/architecture/2026-06-05-chat-runtime-decision.md` — useExternalStoreRuntime + per-chat controller (react-opencode shape), no message cache, refetch-on-gap, useRemoteThreadListRuntime; rejects AssistantTransport (@alpha). Includes the 3-round evidence.
- `docs/architecture/2026-06-05-native-tool-rendering-seams.md` — why tool cards are native `ToolCallMessagePartComponent` (not custom props) and why grouping is **daemon-authoritative** (`metadata.custom.partGroups`, not a tool-name list). Records the GroupedParts-vs-by_name tension + the deprecated `useAssistantToolUI`. Both seams removed.
- `docs/architecture/2026-06-04-app-tauri-architecture.md` — target folder tree + principles (feature-first, lib/tauri seam, surface-intent bus, shadcn-first).
- `docs/architecture/2026-06-04-app-tauri-architecture-critique.md` — the adversarial risks (C1 env, mobile-co-owned contract, missing workstreams).

### D. Design reference — the VISUAL/behavior spec (vendored into `docs/design-reference/`)
The warm-chrome prototype, made durable here (source: Claude Design — see URLs below). Per the golden rule, this is what you diff against.
- `HANDOFF-screens.md` — the prototype→production handoff overview (the spec's table of contents).
- `component-map.md` — **every wireframe element → its shadcn/assistant-ui/Monaco equivalent**, with customization notes + §6 primitives/icons + §7 state inventory. Your first stop for "which component + how to style it."
- `mainframe-theme.css` — the design tokens as the shadcn/Tailwind-v4 theme contract (`:root`/`.dark`/`@theme` + `--mf-*`). Drop into the renderer; styles shadcn AND assistant-ui in one shot.
- `ADR-001-editor-monaco-vs-cm6.md` — the editor decision.
- `artboards/*.html` — interactive prototype screens: `Workspace Surfaces.html` (the living workspace), `Composer States.html`, `Primitives.html`, `Chat Cards Review.html`, `User Message States.html`, `Tasks Review.html`, `Popovers Review.html`, `Window States.html`, `Viewers Review.html`, `Chat Markers Review.html`, `Design Tokens Report.html`. **Read the source, don't screenshot** — dimensions/colors/states are in the markup.
- `prototype/*.jsx` — the throwaway prototype source (React-via-Babel). **Recreate visual intent, do NOT port internals.** Useful for behavior (e.g. `03-content.jsx` composer controls, `05-settings.jsx` providers, `09-toolcards.jsx`, `10-chatcards.jsx`).

### E. Backend / CLI-protocol references (the daemon contract you consume)
- `docs/adapters/claude/` — `PROTOCOL_REVERSED.md`, `COMPACTION.md`, `INTERRUPT.md`, `CONTEXT_USAGE.md`, `MODELS.md`, `TODOS.md`, `PR_TRACKING.md`.
- `.claude/skills/claude-protocol-debugger/cli-binary-internals.md` · `.claude/skills/codex-protocol-debugger/SKILL.md` — reverse-engineered CLI internals.
- `docs/superpowers/specs/2026-06-04-model-config-flags-design.md` (+ the plan) — the model/harness-config feature (already in `main`); reference for the composer tuning data model.
- The daemon itself (`packages/core`) is the source of truth for WS events / REST shapes — read it, don't assume.

### F. External / upstream
- **`@assistant-ui/react-opencode`** — assistant-ui's official adapter for a stateful CLI coding agent. **This is our runtime blueprint** (controller + reducer + projection + `extras` + `useRemoteThreadListRuntime`). Clone HEAD to read it: `git clone --depth 1 https://github.com/assistant-ui/assistant-ui` → `packages/react-opencode/src/`. **Read installed/cloned source over the website docs — the docs drift (it bit us once).**
- Claude Design source bundles (re-fetchable; gzip-tar via WebFetch):
  - HANDOFF-screens (primary): `https://api.anthropic.com/v1/design/h/M67O20dWz0SuTluxmpcu6A`
  - Typed-surface / workspace docking brainstorm: `https://api.anthropic.com/v1/design/h/Mn33Zu6-WYtbbDFIP6zKxw`
  - model-config-flags task: `https://api.anthropic.com/v1/design/h/V7w6hyfFfbXAHA8JwNxBOg`

## The flow (how the pieces connect)
1. The **typed-surface UX** (Chat/Files/Run + surface rail, by-arrival, per-session layout) was brainstormed, then formalized in the architecture doc.
2. The repo was **mapped** (10 subsystems → dispositions) → that's the tracker.
3. The plan was **critiqued** (risks) → the critique doc.
4. **C1** (bare-env agent spawn) was de-risked via the Tauri sidecar + login-shell env capture spike.
5. The **chat runtime** was decided over 3 research rounds → ADR; the **react-opencode** blueprint validated it.
6. The **chat seam** was built (Phase 1 spine → Phase 2A controller/reducer), drift-free, no message cache.
7. Remaining work = the **leaves** in the tracker, built per the golden rule.

## Operating rules for agents
- **Obey `packages/app-tauri/CLAUDE.md`.** Especially the stop-and-ask gate for chat components. *(Subagents can't prompt the user → on a mismatch, build nothing and return the design-vs-native summary to the orchestrator.)*
- **Update `MIGRATION-TRACKER.md`** status marks when you land a surface.
- **Verify empirically**, not just typecheck (run the app/daemon; the drift test is the canonical chat check).
- **Per-surface DoD** (see CLAUDE.md): typecheck+tests green · matches the artboard (design-conformance) · thermo-nuclear standards · data-testids · no `getState()` reach-through · <300 lines · obsolete code dropped · tracker updated.
- Don't touch `packages/desktop/` (reference only). Daemon WS/REST contract is mobile-co-owned → additive changes only.

## Toolkit
- **Skills:** `tauri-v2`, `shadcn`, `assistant-ui`, `radix-ui-design-system`, `rust-best-practices`, `architecture-review` (warden), `thermo-nuclear-code-quality-review` (user-invocable only — apply its standards), `claude/codex-protocol-debugger`.
- **Agents:** `tauri-shell-engineer` (Rust/Tauri shell + sidecar) · `renderer-porter` (port a component) · `design-conformance` (vs artboards) · `test-writer`.
- **Review-gate hook** (`.claude/settings.json`): on `git commit`, a new `packages/app-tauri/src/{features,surfaces,components}` file triggers a reminder to review (thermo-nuclear + design-conformance).
