# Mainframe — Developer Handoff (prototype → production)

> The Mainframe desktop app has been fully designed as an interactive **visual spec** in a
> **warm-chrome**, macOS-native language. This document tells you how to build the production
> app from that spec. The prototype is HTML + React-via-Babel and is **throwaway** — do not
> port its internals; port the **visual intent** using the handoff artifacts below.

**Date:** 2026-06-03 · **Last design pass:** 2026-06-12 (chrome + appearance system — see `handoff/component-map.md` §8–§9) · **Production scaffold:** `desktop/` (already set up)

---

## 1. Where the spec lives

- **`Workspace Surfaces.html`** — the living, interactive workspace prototype (chrome, surfaces, chat, composer, all wired the real way). Open it to see how everything fits together and behaves.
- **Component review canvases** — one per multi-state component family, each laying out every state/variant:
  `Chat Cards Review.html` · `Chat Markers Review.html` · `User Message States.html` · `Composer States.html` · `Tasks Review.html` · `Popovers Review.html` · `Window States.html` · `Viewers Review.html`.
- **Design-system reference pages:**
  - `Design Tokens Report.html` — the complete color / type / surface token vocabulary.
  - `Primitives.html` — the atoms (buttons, pills, form controls, status dots) **and the full icon set with names**, rendered from the real components. This is the 1:1 visual target when theming the equivalent shadcn primitives.

---

## 2. Production stack (decided with the user)

**Electron + electron-vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui · assistant-ui · Zustand · Monaco · xterm · Shiki** — already scaffolded in `desktop/`.

Key decisions:
- **Chat thread = assistant-ui** (Thread / Message / Reasoning / ToolGroup / Composer primitives). The chat cards we designed (Thinking, tool cards, markdown, composer) are **restyled assistant-ui slots, not rebuilds** — our designs are the styling target.
- **Component layer = shadcn** (NOT raw Radix). assistant-ui *is* shadcn, so one theme contract styles everything; raw Radix would mean two systems kept in sync by hand.
- **Runtime = `AssistantTransport`** (assistant-ui custom runtime). The **daemon** owns authoritative agent state and streams snapshots; the renderer is a stateless view + bidirectional commands (worktree / branch / task / permission). The daemon owns the FS + LSP; code stays remote.
- **Editor = Monaco** (UI + ⌘-click / peek / references), wired to the daemon's LSP over WS/JSON-RPC (already implemented in `desktop/`). Theme via `defineTheme` from `--mf-code-*`.
- The prototype itself is **not** being rewritten to shadcn — the theme + map are the higher-leverage carry-forward.

---

## 3. Handoff artifacts — use these

| Artifact | What it gives you |
|---|---|
| **`handoff/mainframe-theme.css`** | The prototype's design tokens emitted as the **shadcn / Tailwind v4 theme contract** — now SIX blocks: `:root`/`.dark` (Classic) plus `[data-scheme="ocean"]` / `[data-scheme="velvet"]` light+dark overrides, with the **accent themed per mode×scheme**. Drop into `src/renderer/index.css`; it styles your shadcn components **and** every assistant-ui component (same vars) in one shot. Includes `--mf-*` extensions for surfaces shadcn has no slot for (window chrome, code/terminal palettes, user-message cool card, viewer matte) and the `[data-noring]` focus-ring opt-out. |
| **`handoff/component-map.md`** | Every wireframe element → its **shadcn / assistant-ui / Monaco** equivalent, with per-component customization notes, the warm-chrome deltas from shadcn defaults, a reconciliation checklist, **§6 Primitives & icons** (atom → shadcn mapping + the lucide icon inventory), **§8 the Appearance system (Mode × Colour Scheme × Window Style)** — the contract for adapting an existing layout — and **§9 the 2026-06-12 session changelog**. Removes "which component do I build, and how do I style it" guesswork. |
| **`handoff/ADR-001-editor-monaco-vs-cm6.md`** | The editor decision. If CodeMirror 6 is ever reconsidered, this maps what ports for free (the LSP layer is already editor-agnostic) vs. what must be rebuilt (peek, references panel), and recommends a cheaper hybrid first. |

**Build order:** drop in `mainframe-theme.css` → stand up the shadcn + assistant-ui shells → work component-by-component through `component-map.md`, diffing each themed primitive against `Primitives.html` / the relevant review canvas.

---

## 4. What the spec covers (surface area)

Everything below is designed and reviewable in the prototype. Build each to match.

- **Window chrome & shell** — title bar / traffic lights + **Update pill** (sidebar header), main toolbar (search, launch picker/run, **surface rail**, mode toggle, inspector toggle), and **three window styles** (unified · split · glass — `component-map.md` §8.3). There is **no window-wide status bar** — the sidebar's footer carries Connected + session counts, and surfaces run full-height. Three **typed surfaces** (Chat · Files · Run) with split + per-session remembered layouts.
- **Appearance system** — Mode (light/dark) × Colour scheme (classic/ocean/velvet) × Window style, 18 valid combinations; accent, code + terminal palettes themed per mode×scheme. Contract: `component-map.md` §8; tokens: `mainframe-theme.css`.
- **Sidebar** — full-height: dense session list (status glyphs incl. the **unread-answer system**: amber pip + halo + “Answer ready” pill; no count badges), grouped by time; project filter pills + **Add project**; sessions **sort** menu + **more** menu (archived / import external); settings gear; footer (Connected + derived session-state counts).
- **Chat thread** — assistant/user turns, the **user-turn system** (text + Read-more clamp, @mentions, /command, /skill, plan card, queued, rich attachments, sent-with-context chips, code-review snippet), **Markdown** rendering, **tool cards** (read/edit/write/bash/grep/todo/web), and **system markers** (compaction, skill-loaded, worktree, schedule, MCP, subagent task group + progress).
- **Interactive chat cards** — Thinking/reasoning, **Ask-a-question** (single-select / multi-select / free-text "Other" / answered), **Permission** (tool name + JSON input details + Deny / Allow once / Always allow gated on suggestions), **Plan approval** (steps + touched files + exec-mode tray).
- **Composer** — model/provider selector (locks after first message), permission mode, plan toggle, **dynamic reasoning-effort picker + harness-features popover (Fast / Ultracode / Adaptive thinking) driven per-model by advertised capabilities**, worktree button, sandbox-context capture chips.
- **Editor & viewers** — code editor (Monaco target) + inline comment widget + diff, terminal, and non-code **file viewers** (Markdown, CSV, image, SVG, PDF, unsupported).
- **Overlays / modals / palettes** — Settings, command palette (`⌘O`), diff **review** modal, **popover system** (branch switcher with worktree sections + per-branch submenu, new-branch, tag, context menu), **directory picker** (Add project), window-level states (toasts, connection overlay, first-run tutorial, error boundary).
- **Tasks** — an agent-first task list (status-dot lifecycle, inline expand, Start session, keyboard nav) with a List⇄Board toggle, filter toolbar, edit modal, and quick-add.

For exact fields / behavior / states of any component, read the source (next section). The prototype already made the design decisions.

---

## 5. Reading the source

The attached `desktop/` codebase is the **feature spec** — read it to learn what each component must *do*. Source is the **built bundle**: grep `desktop/out/renderer/assets/*.js` and `desktop/out/src/renderer/components/**` (NOT `desktop/src/...`, which may be absent).

**Important — the prototype is a deliberate redesign, not a copy of the source UI.** Where the prototype's look diverges from the source app's markup (e.g. the Tasks surface is an agent-first list, not the source's kanban; the permission card shows the raw tool `input` not a fabricated risk/scope; filter bars are compact toolbars not chip walls), **the prototype is the intended design** — match it, and use the source only for the underlying data model and behavior.

When the data model matters (e.g. what a permission `ControlRequest` or a `Todo` actually carries), verify against the source `*-api.ts` / types rather than assuming — the prototype was corrected several times to only show fields the backend really has.
