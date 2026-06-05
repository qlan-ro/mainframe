# app-tauri Migration — START HERE (agent onboarding)

If you're picking up the **desktop (Electron) → app-tauri (Tauri 2 + React)** migration in a fresh session, read this first. It catalogs every document, says what each is for and *when* to use it, and encodes the flow so you boot with near-parity context.

## Read in this order
1. **`packages/app-tauri/CLAUDE.md`** — the *rules* (auto-loaded when you work in the package). The ⭐ golden rule: for any chat/thread/thread-list/message/tool-card/permission/composer component → research what assistant-ui ships, compare to our design, **use+restyle if it matches, else STOP and ask** with a design-vs-native summary.
2. **This index** — the map.
3. **`MIGRATION-TRACKER.md`** — *what's left*: every surface with disposition (port/refactor/replace/drop) + status + target home. Update it as you land work.
4. **`2026-06-05-chat-runtime-decision.md`** (ADR, + the react-opencode update) — *the* runtime decision and why.
5. **`2026-06-04-app-tauri-architecture.md`** + **`-critique.md`** — target structure + the risks that shaped it.

## Document catalog

### A. How to build (rules — obey these)
- `packages/app-tauri/CLAUDE.md` — golden rule (assistant-ui-first, stop-and-ask), runtime, architecture, conventions, daemon-contract, per-surface DoD.
- Root `CLAUDE.md` — monorepo-wide code rules (security, async, file-size, data-testids) still apply.

### B. State & plan
- `docs/architecture/MIGRATION-TRACKER.md` — the living checklist (folds in the 10-subsystem port analysis).

### C. Decisions (the "why", locked)
- `docs/architecture/2026-06-05-chat-runtime-decision.md` — useExternalStoreRuntime + per-chat controller (react-opencode shape), no message cache, refetch-on-gap, useRemoteThreadListRuntime; rejects AssistantTransport (@alpha). Includes the 3-round evidence.
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
