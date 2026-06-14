# Claude Code task — implement Model & Harness Config Flags

> Paste this as your task prompt. It implements the approved design at
> `feat/model-config-flags`. The **what/why is already decided** — your job is to build it
> exactly as specified, not to redesign it.

## ⚠️ Read this first — the target is a NEW Tauri package

This feature ships in a **new, greenfield UI package built on Tauri** (not Electron). It is a
**parallel implementation** — it does **not** modify or replace the existing `desktop/`
Electron UI. Treat `desktop/` strictly as a **reference** for behavior and as the visual
target's source; do not edit it.

Concretely:
- **New package** for the renderer UI (React + the chosen component layer). Build the composer
  controls and settings UI **here**, fresh. The file paths in §5/§6 below name the *existing*
  `desktop/...` files **only as reference** for what each component must do — create the
  equivalents in the new package, don't touch the originals.
- **Tauri shell** replaces Electron: the app window, lifecycle, and any native bridge go
  through Tauri (Rust core + `@tauri-apps/api` from the renderer) instead of Electron main/IPC.
  Wherever the design doc or `desktop/` assumes Electron IPC/`ipcRenderer`, substitute the
  Tauri command/event equivalent.
- The **shared backend layers** (types in `packages/`, probe/normalize/apply/API in `core/`)
  are reused as the design doc specifies *if* this package consumes the same monorepo. If the
  new package is standalone, port those layers into it verbatim from the doc — same types,
  same precedence, same apply mechanics. **Confirm which, then proceed.**
- The **daemon ↔ renderer** split from the handoff still holds: the daemon owns authoritative
  agent state; the renderer is a stateless view + commands. Tauri shells that renderer; it does
  not change the daemon contract.

Everything below is unchanged in *intent* — only the host (Tauri) and the *location* (new
package) differ. Where it says "extend `desktop/.../X.tsx`", read "build X in the new package,
using `desktop/.../X.tsx` as the behavior reference."

---

## Context you must read first

1. **The design doc** — `Model & Harness Config Flags — Design` (the approved spec, dated 2026-06-04). It is the source of truth for types, precedence, apply mechanics, file list, and test plan. Sections referenced below (S1–S7) are its sections.
2. **The visual spec** — the warm-chrome prototype already designed every piece of this UI. Open these and **match them**:
   - `Composer States.html` → section **"Model & harness config flags"** — 5 artboards showing the exact end-state of the composer controls (Opus / Sonnet / Codex / Haiku / Ultracode-locked).
   - `Workspace Surfaces.html` → **⌘, → Settings → Providers** — the Default-effort dropdown, Default-features toggles, and the Codex tuning block.
   - `handoff/component-map.md` **§7 "State inventory"** → the *Composer config + model tuning* and *Provider defaults* entries: the exact field names, enums, gating rules, and states.
   - The prototype implementation of the controls lives in `mainframe/03-content.jsx` (`EffortPicker`, `FeaturesPopover`, `EFFORT_META`, `FEATURES`, `modelCap`) and `mainframe/05-settings.jsx` (`StgProvider`) — read them for the intended **behavior**, then build the real thing with shadcn/assistant-ui primitives. **Do not port the prototype's inline styles.**

**Golden rule:** the prototype shows *how it should look and behave*; the design doc says *what types/wiring to build*; the CLI source (`desktop/out/...`, adapter `*.ts`) says *what each CLI actually advertises and accepts*. Reconcile all three; invent nothing.

---

## What to build (in dependency order)

Work bottom-up so each layer compiles before the UI consumes it. Land it in these commits:

### 1. Types (S1)
- `packages/types/src/adapter.ts`: add `EffortLevel` union and the dynamic `AdapterModel` capability fields (`supportedEfforts`, `defaultEffort`, `supportsFast`, `supportsUltracode`, `supportsAdaptiveThinking`, `supportsPersonality`). **Remove** `supportsEffort`/`supportsFastMode`/`supportsAutoMode`.
- `packages/types/src/chat.ts`: add `SessionTuning` (`effort`/`fast`/`ultracode`/`adaptiveThinking`, each `| null`). Widen `Chat.effort` to `EffortLevel | null` and add the three boolean fields; make `ChatEffort = EffortLevel`.
- `packages/types/src/settings.ts`: add the `ProviderConfig` fields (`defaultEffort`, `defaultFast`/`defaultUltracode`/`defaultAdaptiveThinking` as `'true'|'false'`, Codex `personality`/`reasoningSummary`/`verbosity`).
- `AdapterSession.applyTuning(t: SessionTuning): Promise<void>`; `SessionOptions.effort` → `tuning?: SessionTuning`.
- **Derivation rule (critical):** `supportsUltracode` is **not probed** — derive it as *Claude adapter **and** `supportedEfforts.includes('xhigh')`*. Codex also advertises `xhigh` as a plain effort but must **not** expose Ultracode. (The prototype got this wrong once; don't repeat it.)

### 2. Probe / normalize (S2)
- Claude `probe-models.ts` `mapModelInfo`: map `supportedEffortLevels` → `supportedEfforts`, `supportsFastMode` → `supportsFast`, `supportsAdaptiveThinking`, derive `supportsUltracode`. Update the static `CLAUDE_MODELS` fallback to the new fields.
- Codex `adapter.ts` `listModels`: replace the `{id,label}`-only map with the full `Model` map (effort array, `defaultEffort`, `supportsFast` from `additionalSpeedTiers.includes('fast')`, `supportsPersonality`, `isDefault`); **filter out `hidden` models**; keep `[]` on probe failure.

### 3. Apply layer (S3)
- New pure `resolveTuning(chat, providerConfig, model): Required<SessionTuning>` with precedence **model.defaultEffort ◄ provider default ◄ chat override ◄ live toggle**.
- Claude `session.ts` `applyTuning`: emit the `apply_flag_settings` control request (`effortLevel`/`fastMode`/`ultracode`/`alwaysThinkingEnabled`; `null` clears). Verify the envelope against the v2.1.156 binary handler.
- Codex `session.ts`: thread resolved tuning into `turn/start` (`effort`, `serviceTier: fast ? 'fast' : 'flex'`, plus settings-level `personality`/`summary`/`verbosity`); stop hardcoding `reasoning_effort: null` in `buildCollaborationMode()`. `applyTuning` updates pending per-turn tuning.
- `ChatManager`: build tuning via `resolveTuning` at spawn; `applyTuning(chatId, partial)` → active session or no-op.

### 4. Persistence + API (S6)
- `db/schema.ts`: three nullable `INTEGER` columns (`fast`/`ultracode`/`adaptive_thinking`), same idempotent ALTER pattern as `effort`. `db/chats.ts`: camel↔snake + `0/1/null ↔ boolean|null`.
- Generalize `PATCH /api/chats/:id/effort` into `PATCH /api/chats/:id/tuning` (Zod, accepts any subset, `null` clears) → `db.chats.update` → `syncChatFields` → `ChatManager.applyTuning`. **Keep `/effort`** (enum widened) so the mobile submodule doesn't break.
- Extend the provider-settings PUT Zod with the new enum fields (key-value store, **no migration**).

### 5. Composer UX (S4) — build in the new package, match `Composer States.html`
> Reference files named below are the `desktop/` Electron originals — build the Tauri-package equivalents, don't edit them.
- Extract a shared `lib/model-tuning.ts`: `EFFORT_META`, the `FEATURES` table, gating predicates (3+ consumers → shared per repo convention).
- `EffortPicker.tsx`: options from `model.supportedEfforts` (not a frozen list); visible only when length > 0; writes `setChatTuning(chatId, {effort})` + live `applyTuning`.
- New `FeaturesPopover.tsx`: `FEATURES.filter(f => model[f.cap])`, each row an existing `ui/toggle.tsx` `<Toggle>` (role="switch"); hide the trigger when empty; **ticking Ultracode sets+locks effort to xhigh**; optimistic update → persist → live apply.
- Both disabled while `chat.isRunning`. `data-testid`s: `composer-features-trigger`, `composer-feature-<key>`, keep `composer-effort-select`.

### 6. Settings → Provider (S5) — build in the new package, match the prototype's Providers pane
- `ProviderSection.tsx`: Default-effort dropdown (gated off `config.defaultModel`'s `supportedEfforts`), Default-features `<Toggle>`s (same `FEATURES` table), and a Codex-only block (Personality — additionally gated by `model.supportsPersonality` — Reasoning Summary, Verbosity). Write through the existing `update(...)` path. `data-testid`s per S5.
- At chat creation, seed the new `Chat` tuning from provider defaults via `resolveTuning` (string→enum/bool decode).

### 7. Tests (S7)
Implement the full matrix in S7 — probe/normalize (incl. Sonnet-without-xhigh → ultracode false, Codex `hidden` filtered), apply layer (exact `apply_flag_settings` envelope, Codex serviceTier, `resolveTuning` precedence), API (`/tuning` Zod + `/effort` back-comat), UI gating (Opus 3 / Codex Fast-only / Haiku hidden, Ultracode↔xhigh), and the e2e specs + **mock capability fixtures** (the mock CLI must advertise the new fields or the UI gates everything off).

---

## Acceptance — the gating matrix (verify against the prototype)

| Model | Effort options | Feature toggles |
|---|---|---|
| **Opus** | low / medium / high / xhigh / max | Fast · Ultracode · Adaptive thinking |
| **Sonnet** | low / medium / high | Fast · Adaptive thinking (**no Ultracode**) |
| **Codex GPT-5** | low / medium / high / xhigh | **Fast only** (no Ultracode despite xhigh; no Adaptive) |
| **Haiku** | — (picker hidden) | — (⚙ hidden) |

Plus: Ultracode ON ⇒ effort locked to xhigh; all controls disabled while running; provider defaults seed new chats and a per-chat override doesn't leak back to the default.

## Scope discipline
- **Out of scope** (S "Out of scope"): the existing **`desktop/` Electron UI** (untouched — this is a parallel Tauri package), the mobile submodule UI (separate PR; `/effort` keeps it working), `auto` permission mode, engineering away the Codex per-turn-vs-live asymmetry.
- Don't redesign the controls — the prototype + design doc already settled the UX. If something is genuinely ambiguous, ask before diverging.

When done: typecheck + the S7 suites green, and the composer/settings match the artboards in `Composer States.html` and the Providers pane in `Workspace Surfaces.html`.
