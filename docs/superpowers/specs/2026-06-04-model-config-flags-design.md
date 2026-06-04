# Model & Harness Config Flags — Design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)
**Branch:** `feat/model-config-flags`

## Problem

Both CLI adapters advertise a rich, per-model set of configuration knobs in their
`initialize` / `model/list` responses. Mainframe probes that payload but discards
almost all of it, then **hardcodes** the choices it offers:

- **Claude** (`initialize`, v2.1.156) returns per-model `supportedEffortLevels`
  (`low/medium/high/xhigh/max`), `supportsAdaptiveThinking`, `supportsFastMode`,
  plus the session-level `ultracode` flag. Mainframe keeps only the `supportsEffort`
  boolean and hardcodes `EFFORT_OPTIONS` to `low/medium/high`. `xhigh`, `max`,
  fast mode, ultracode, and adaptive thinking are all unreachable.
- **Codex** (`model/list`, codex-cli 0.125.0) returns the full `Model` type:
  per-model `supportedReasoningEfforts` (`low/medium/high/xhigh`),
  `defaultReasoningEffort`, `additionalSpeedTiers` (`["fast"]`),
  `supportsPersonality`, `isDefault`, `hidden`. Mainframe maps only `{id, label}`
  and hardcodes `reasoning_effort: null` — so Codex effort, fast (serviceTier),
  personality, and reasoning summary are unreachable, and hidden models leak into
  the picker.

Two CLIs converged on the same shape (per-model effort arrays topping out at
`xhigh`; a "fast" concept; a default marker), and Mainframe has the **same failure
on both**: it throws the capability payload away and hardcodes. There is also no
**apply path** for the runtime-only flags (Claude `apply_flag_settings`; Codex
`turn/start` overrides).

Provenance of these findings: `.claude/skills/claude-protocol-debugger/cli-binary-internals.md`
(Claude) and `.claude/skills/codex-protocol-debugger/SKILL.md` (Codex).

## Goal

Surface the full set of model/harness config flags, driven dynamically by what each
selected model actually advertises — nothing hardcoded. Split by cadence:

- **Composer (per-chat, toggled live):** effort, fast, ultracode, adaptive thinking.
- **Settings → Provider (per-adapter defaults):** default effort + default feature
  toggles, plus Codex-only personality / reasoning summary / verbosity.

## Approach

**Unified capability fields, adapter-translated apply.** One canonical `AdapterModel`
carries dynamic capability data; the composer reads it and renders generically,
never branching on `adapterId`. A unified `SessionTuning` shape rides on chat /
provider / session; each adapter translates it to its native mechanism (Claude →
`apply_flag_settings` live; Codex → `turn/start` overrides).

Rejected alternatives:
- **Opaque per-adapter capability blob** — zero data loss but violates the
  "single canonical type" rule and scatters `if (adapterId === …)` through the UI.
- **Spawn-only apply** — simplest, but discards Claude's cheap live
  `apply_flag_settings`; flipping effort would feel laggy.

## Capability model & tuning types (Section 1)

```ts
// packages/types/src/adapter.ts
// Full union across both CLIs. Codex ReasoningEffort = none/minimal/low/medium/high/xhigh;
// Claude adds 'max'. The per-model `supportedEfforts` array is the runtime gate — most
// models expose only a subset (live: Codex low–xhigh, Claude low–max), so 'none'/'minimal'
// simply never appear in the UI unless a model lists them.
export type EffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AdapterModel {
  id: string;
  label: string;
  description?: string;
  contextWindow?: number;
  isDefault?: boolean;

  // Effort — dynamic, per-model (replaces the old boolean `supportsEffort`)
  supportedEfforts?: EffortLevel[];
  defaultEffort?: EffortLevel;

  // Boolean feature capabilities — gate the composer popover items, per provider
  supportsFast?: boolean;              // Claude fastMode | Codex serviceTier:'fast'
  supportsUltracode?: boolean;         // Claude only (derived: supportedEfforts includes 'xhigh')
  supportsAdaptiveThinking?: boolean;  // Claude only
  supportsPersonality?: boolean;       // Codex only (consumed in settings, not the popover)
}
```

```ts
// packages/types/src/chat.ts
export interface SessionTuning {
  effort?: EffortLevel | null;       // null = inherit provider default → model default
  fast?: boolean | null;
  ultracode?: boolean | null;
  adaptiveThinking?: boolean | null;
}
```

Precedence chain (resolved by `resolveTuning`, Section 3):

```
model.defaultEffort  ◄─  ProviderConfig defaults  ◄─  Chat (per-chat override)  ◄─  live composer toggle
   (built-in)              (settings)                  (persisted)                  (this session, runtime)
```

Notes:
- `supportsEffort` / `supportsFastMode` / `supportsAutoMode` are **removed** from
  `AdapterModel`. `supportsEffort` → derive from `supportedEfforts?.length`;
  `supportsFastMode` → `supportsFast`; `supportsAutoMode` is a permission-mode
  concept and out of scope here.
- `EffortLevel` is a closed union for type safety; the per-model `supportedEfforts`
  array is the **runtime gate** — the UI only ever offers what the model lists.
- `supportsUltracode` is **derived**, not probed: `supportedEfforts.includes('xhigh')`
  (ultracode forces xhigh, so a model without xhigh — e.g. Sonnet — hides it).
- `SessionTuning` fields are `| null` so "explicitly unset → fall back to the layer
  below" is distinct from "not configured." **`null`/absent is stored, never a
  concrete copy** — see the inheritance rule in Section 5. Effective values are
  resolved at render/spawn, so later changes to a provider default still propagate
  to chats that never overrode it.
- **Ultracode coercion is a resolver invariant, not just a UI nicety.** Because the
  Claude CLI resolves an explicit `--effort` *before* `settings.ultracode`, the data
  model alone allows the contradictory `effort:low + ultracode:true`. `resolveTuning`
  (Section 3) collapses this: when `ultracode` resolves truthy, `effort` is coerced
  to `'xhigh'`. This makes spawn and live-apply agree regardless of how the values
  were persisted, and is why Claude effort is applied via `apply_flag_settings` (not
  the `--effort` spawn flag) — see Section 3.

## Probe / normalize layer (Section 2)

**Claude — `probe-models.ts` (`mapModelInfo`)**

```ts
supportedEfforts         = info.supportedEffortLevels;
defaultEffort            = undefined;                          // Claude advertises none; UI falls back to 'medium'
supportsFast             = info.supportsFastMode;
supportsAdaptiveThinking = info.supportsAdaptiveThinking;
supportsUltracode        = info.supportedEffortLevels?.includes('xhigh');  // derived
```

**Codex — `adapter.ts` `listModels`** (replaces the `{id, label}`-only map)

```ts
result.data
  .filter(m => !m.hidden)
  .map(m => ({
    id: m.id,
    label: m.displayName ?? m.id,
    description: m.description,
    isDefault: m.isDefault,
    supportedEfforts: m.supportedReasoningEfforts.map(e => e.reasoningEffort),
    defaultEffort: m.defaultReasoningEffort,
    supportsFast: m.additionalSpeedTiers.includes('fast'),
    supportsPersonality: m.supportsPersonality,
  }));
```

Supporting cleanups:
- Claude static `CLAUDE_MODELS` catalog updated to the new fields so the offline
  fallback (probe timeout/failure) still renders sensibly; the live probe overrides
  it; `enrichWithContextWindow` unchanged.
- Codex `listModels` still returns `[]` on probe failure (existing behavior; noted,
  not a regression).

Net effect: effort/feature options become a pure function of `model.*` capability
fields. Opus → `low–max` + Fast/Ultracode/Adaptive-thinking; Sonnet drops Ultracode;
Codex → `low–xhigh` + Fast; Haiku → neither effort nor flags.

## Apply layer (Section 3)

A shared pure resolver computes effective tuning, then each adapter translates it.
**The resolver both resolves precedence and clamps to the target model's
capabilities** — UI gating alone is not enough, because stored chat/provider values
can become invalid after a model switch (e.g. a chat carrying `xhigh`/`ultracode`
moved to a model that supports neither).

```ts
// resolveTuning(chat, providerConfig, model): Required<SessionTuning>
//
// 1. precedence (per field):  chat override ?? provider default ?? model.defaultEffort ?? 'medium' / false
// 2. clamp to capabilities:
//      effort  → if not in model.supportedEfforts: fall back to model.defaultEffort
//                (or nearest supported ≤ requested, else 'medium')
//      fast             → false unless model.supportsFast
//      ultracode        → false unless model.supportsUltracode
//      adaptiveThinking → false unless model.supportsAdaptiveThinking
// 3. coherence:  if ultracode === true → effort = 'xhigh'   (see Section 1 invariant)
//
// Pure + total: same (chat, provider, model) always yields a valid Required<SessionTuning>.
```

`resolveTuning` runs at spawn (seeds `SessionSpawnOptions.tuning`), on every composer
toggle, **and on model switch** — `setModel` re-resolves against the new model and
calls `applyTuning(resolved)` so stale/invalid values are never sent.

**Claude — `apply_flag_settings`** (extends the existing `sendControlRequest` setters)

Claude effort is applied via `apply_flag_settings`, **not** the `--effort` spawn flag
— the CLI resolves an explicit `--effort` before `settings.ultracode`, so a spawn
flag would defeat the ultracode→xhigh coercion. Only `--model` stays a spawn arg.
All four knobs (`effortLevel`, `fastMode`, `ultracode`, `alwaysThinkingEnabled`) flow
through one envelope, applied once at startup and on every change:

```ts
async applyTuning(t: SessionTuning): Promise<void> {
  const settings: Record<string, unknown> = {};
  if (t.effort !== undefined)           settings.effortLevel = t.effort;        // null clears
  if (t.fast !== undefined)             settings.fastMode = t.fast;
  if (t.ultracode !== undefined)        settings.ultracode = t.ultracode;
  if (t.adaptiveThinking !== undefined) settings.alwaysThinkingEnabled = t.adaptiveThinking;
  this.sendControlRequest(child.stdin, { subtype: 'apply_flag_settings', settings });
}
```

Envelope verified against the v2.1.156 binary: the handler reads `request.settings`,
folds `model`/`effortLevel`/`ultracode` into app state, merges the rest. Mirrors the
existing `setModel`/`setPermissionMode` pattern.

**Startup timing:** `ClaudeSession.spawn()` writes the resolved-tuning
`apply_flag_settings` to stdin **immediately after spawn**, before the first user
message. The CLI buffers stdin and `system:init` only fires after the first API call,
so this is the same proactive-stdin pattern already used for the resume permission
path — it guarantees provider-default `fast`/`ultracode` are in effect on the first
send, not one turn late. (If we instead deferred to a `system:init` hook the first
fast user send could race ahead of it.)

**Codex — `turn/start` overrides** (replaces hardcoded `reasoning_effort: null`)

Codex's `turn/start` **always** sends `collaborationMode`, and per the generated
schema `collaborationMode` *takes precedence over* top-level `model`/`effort`/
`reasoning_effort`. So effort must live in `collaborationMode.settings.reasoning_effort`
(not top-level `turn/start.effort`, which would be ignored). The knobs
`collaborationMode.settings` does **not** carry — `serviceTier`, `personality`,
`summary`, `verbosity` — go on the top-level `turn/start` params:

```ts
// collaborationMode.settings (built by buildCollaborationMode — no longer hardcodes null):
{ model: resolved.model, reasoning_effort: resolved.effort, developer_instructions: null }

// top-level turn/start params:
serviceTier: resolved.fast ? 'fast' : 'flex',   // only when model.supportsFast
personality,                                     // from ProviderConfig (Section 5), if model.supportsPersonality
summary, verbosity,                              // from ProviderConfig (Section 5)
```

Exact field names/enums to be re-verified against `codex app-server generate-ts`
during implementation (the `codex-protocol-debugger` skill documents the current
`Settings` / `TurnStartParams` shapes). Codex `applyTuning()` updates the session's
pending tuning used by the next `turn/start` (no separate control message — per-turn
is the protocol's own mechanism).

**Asymmetry (accepted):** Claude applies immediately; Codex applies on the next
message. Inherent to the two protocols; the UI treats both as "saved."

**Interface:** `AdapterSession` gains `applyTuning(t: SessionTuning): Promise<void>`.
`SessionSpawnOptions.effort` (the actual interface carrying it today, `adapter.ts:32`
— **not** `SessionOptions`) is replaced by `tuning?: SessionTuning`.

## Composer UX (Section 4)

Two toolbar controls, both pure functions of the selected model's capabilities.

**`EffortPicker` (existing, made dynamic)** — `composer/EffortPicker.tsx`
- Options come from `model.supportedEfforts` instead of the frozen `EFFORT_OPTIONS`.
  A static `EFFORT_META: Record<EffortLevel, {label, description}>` supplies display
  text (adds `xhigh` → "Extra-high", `max` → "Maximum", `minimal`).
- Visibility: `(model.supportedEfforts?.length ?? 0) > 0` (replaces `supportsEffort`).
- Writes `setChatTuning(chatId, { effort })` + live `applyTuning`.

**`FeaturesPopover` (new)** — `composer/FeaturesPopover.tsx`

```
toolbar:  [@ context] [model ▾] [⚡ High ▾] [⚙ ▾]            [send]
                                           └─ popover ──────────────────┐
                                              Fast mode            (●—)  on
                                              Ultracode            (—○)  off
                                              Adaptive thinking    (●—)  on
```

- One row per supported feature, from a declarative table:
  ```ts
  const FEATURES = [
    { key: 'fast',             cap: 'supportsFast',             label: 'Fast mode',         desc: 'Faster output; may draw on usage credits' },
    { key: 'ultracode',        cap: 'supportsUltracode',        label: 'Ultracode',         desc: 'xhigh effort + dynamic workflows' },
    { key: 'adaptiveThinking', cap: 'supportsAdaptiveThinking', label: 'Adaptive thinking', desc: 'Claude decides when/how much to think' },
  ];
  // visible = FEATURES.filter(f => model[f.cap])
  ```
- Each row uses the existing `ui/toggle.tsx` `<Toggle>` switch (`role="switch"`,
  sliding thumb, `bg-mf-accent`), **not** a checkbox.
- **Per-provider falls out for free:** Codex model → only Fast; Opus → all three;
  Sonnet → no Ultracode; Haiku → popover empty, so the `⚙` icon is hidden.
- Each toggle: optimistic store update → `setChatTuning(chatId, { [key]: value })`
  → live `applyTuning`.
- **Coupling:** ticking Ultracode sets/locks the effort chip to `xhigh` with a hint
  (mirrors the CLI forcing xhigh), preventing a contradictory "low + ultracode".

**Shared concerns**
- Both controls disabled while `chat.isRunning`.
- `data-testid`s: trigger `composer-features-trigger`; rows `composer-feature-<key>`;
  effort keeps `composer-effort-select`. `ComposerDropdown`/`Toggle` stay passthrough.

## Settings → Provider defaults (Section 5)

`ProviderConfig` (`packages/types/src/settings.ts`) is a flat key-value store —
**no DB migration** — and already uses string-encoded values.

```ts
export interface ProviderConfig {
  // …existing: defaultModel, defaultMode, defaultPlanMode, executablePath, systemPrompt
  defaultEffort?: EffortLevel;
  defaultFast?: 'true' | 'false';
  defaultUltracode?: 'true' | 'false';
  defaultAdaptiveThinking?: 'true' | 'false';
  // Codex-only model tuning (moved out of the composer)
  personality?: 'none' | 'friendly' | 'pragmatic';
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
  verbosity?: 'low' | 'medium' | 'high';
}
```

`ProviderSection.tsx` additions (capability-gated off `config.defaultModel`'s model):
- **Default Effort** dropdown — options from the default model's `supportedEfforts`
  (same `EFFORT_META`); hidden if none.
- **Default features** — a `<Toggle>` per supported feature, same `FEATURES` table.
- **Codex tuning block** (gated `adapterId === 'codex'`): Personality
  (additionally gated by `model.supportsPersonality`), Reasoning Summary, Verbosity
  dropdowns.
- All write through the existing `update({...})` → `updateProviderSettings` path.
- `data-testid`s: `providers-${adapterId}-default-effort`,
  `providers-${adapterId}-default-feature-${key}`, `providers-${adapterId}-personality`,
  `providers-${adapterId}-reasoning-summary`, `providers-${adapterId}-verbosity`.

**Shared-helper extraction** (CLAUDE.md "extract if 3+ consumers"): `EFFORT_META`,
the `FEATURES` table, and gating predicates move into a shared renderer module
(`lib/model-tuning.ts`) imported by `EffortPicker`, `FeaturesPopover`, and
`ProviderSection`.

**Inheritance (store `null`, resolve late — do NOT seed):** a new chat's tuning
columns are left `null` (= inherit), **not** copied from the provider defaults.
Effective values are computed by `resolveTuning` at render and at spawn. This keeps a
later change to a provider default propagating to every chat that never overrode it;
seeding concrete values at creation would silently freeze the defaults as per-chat
overrides. The composer therefore displays the *resolved* effective value while the
stored value stays `null` until the user explicitly toggles, at which point that one
field becomes a concrete per-chat override (the others remain `null`/inherited).

## Persistence & API (Section 6)

**DB schema** (`db/schema.ts`) — three nullable columns, same idempotent pattern as
the existing `effort` column. Booleans as `INTEGER` (0/1/`null`); **null = inherit**:

```js
if (!cols.some(c => c.name === 'fast'))              db.exec('ALTER TABLE chats ADD COLUMN fast INTEGER');
if (!cols.some(c => c.name === 'ultracode'))         db.exec('ALTER TABLE chats ADD COLUMN ultracode INTEGER');
if (!cols.some(c => c.name === 'adaptive_thinking')) db.exec('ALTER TABLE chats ADD COLUMN adaptive_thinking INTEGER');
```

`db/chats.ts` maps camel↔snake and decodes `0/1/null → boolean|null`.

**`Chat` type** — `effort` widens, three fields join (replacing the lone
`effort?: ChatEffort`):

```ts
effort?: EffortLevel | null;
fast?: boolean | null;
ultracode?: boolean | null;
adaptiveThinking?: boolean | null;
```

`ChatEffort` becomes a `= EffortLevel` alias (keeps existing imports compiling).
This also fixes the other hardcoded `'low'|'medium'|'high'` spots in one move.

**API** — generalize the single-field route into a tuning route, Zod-validated:

```ts
// PATCH /api/chats/:id/tuning  — accepts any subset
const tuningSchema = z.object({
  effort:           z.enum(['minimal','low','medium','high','xhigh','max']).nullable().optional(),
  fast:             z.boolean().nullable().optional(),
  ultracode:        z.boolean().nullable().optional(),
  adaptiveThinking: z.boolean().nullable().optional(),
});
// handler: validate → db.chats.update → syncChatFields → ctx.chats?.applyTuning?.(chatId, partial)
```

- The existing `PATCH /api/chats/:id/effort` **stays** (enum widened to the full set)
  so the **mobile submodule does not break** — it is a subset of `/tuning`. Composer
  uses `/tuning`.
- **Live-apply wiring:** after persisting, the handler calls
  `ChatManager.applyTuning(chatId, partial)`, which looks up the active session and
  calls `session.applyTuning(...)`; no active session → no-op (applied at next spawn
  from the persisted chat).

**Provider settings** — key-value store, no migration. Extend the provider PUT
route's Zod to validate the new enum fields.

**Spawn path** — `SessionSpawnOptions.effort` → `tuning?: SessionTuning`; `ChatManager`
builds it via `resolveTuning(chat, providerConfig, model)` at spawn (resolving the
`null`/inherit values against the live provider defaults and clamping to the model).

## Testing (Section 7)

**Probe / normalize (core)**
- `claude-probe-models.test.ts` — extend: effort array, adaptive-thinking, fast,
  derived ultracode (assert Sonnet-without-xhigh → ultracode false).
- New `codex-list-models.test.ts` — full `Model` → `AdapterModel`: effort array,
  `defaultEffort`, `supportsFast`, `supportsPersonality`, `isDefault`, **`hidden`
  filtered**, `[]` on probe failure.

**Apply layer (core)** — highest-value (new behavior)
- Claude `applyTuning` → exact `apply_flag_settings` envelope; `null` clears; effort
  flows through `apply_flag_settings` (no `--effort` spawn flag). Spawn writes the
  startup tuning to stdin proactively (before first message).
- Codex turn/start → resolved effort lands in `collaborationMode.settings.reasoning_effort`
  (no longer `null`); `serviceTier:'fast'|'flex'` + personality/summary/verbosity on
  top-level params.
- `resolveTuning` — precedence table across all four fields **plus**: capability
  clamping (effort not in `supportedEfforts` → `defaultEffort`; `fast`/`ultracode`/
  `adaptiveThinking` forced false when unsupported), ultracode→xhigh coercion, and
  model-switch re-resolve (`setModel` drops now-invalid stored values, no stale tuning
  sent).

**API (core)**
- `chats.test.ts` — `/tuning` Zod (valid subsets, 400 on bad input, `null` clears,
  persists + calls `syncChatFields`/`applyTuning`); `/effort` accepts widened enum.
- Provider settings route — new enum fields validated/persisted.

**UI (desktop)**
- `EffortPicker.test.tsx` — options render from `supportedEfforts` (xhigh/max for
  Opus, absent for Sonnet/Codex); hidden when none.
- New `FeaturesPopover.test.tsx` — capability gating (Opus → 3, Codex → Fast only,
  Haiku → icon hidden); `<Toggle>` flips call `setChatTuning`; Ultracode↔xhigh
  coupling; disabled while running; `data-testid`s present.
- `ProviderSection.test.tsx` — default-effort + default-feature toggles
  capability-gated; Codex personality/summary/verbosity block Codex-only.

**E2E (`packages/e2e`)**
- **Mock capability fixtures** — the mock CLI plugin's `initialize` / `model/list`
  responses gain the new capability fields (a Claude mock advertising
  `xhigh`/`max` + adaptive-thinking; a Codex mock advertising `supportedReasoningEfforts`
  + `additionalSpeedTiers:['fast']`). Required or the UI gates everything off.
- Extend `44-composer-config.spec.ts` + scenario `composer.md` M5: dynamic effort
  levels; `composer-features-trigger` opens popover; capability gating per provider;
  toggling `composer-feature-ultracode` persists, snaps effort to xhigh, disabled
  while running.
- Extend `41-settings.spec.ts`: provider default-effort + default-feature toggles;
  Codex personality/summary/verbosity block; persistence across modal reopen.
- New inheritance flow: set a provider default → new chat reflects it → per-chat
  override doesn't leak back to the default.

## Out of scope (noted, not silently dropped)

- Mobile submodule UI for the new flags (separate repo/PR per the submodule rule;
  `/effort` back-compat keeps it working meanwhile).
- `auto` permission mode (`supportsAutoMode`) — a permission-mode concern, not
  model tuning.
- Codex per-turn-vs-live apply asymmetry is accepted, not engineered away.

## Files touched (summary)

| Area | Files |
|------|-------|
| Types | `types/src/adapter.ts` (`AdapterModel`, `AdapterSession`, `SessionSpawnOptions`), `types/src/chat.ts` (`SessionTuning`, `Chat`, `ChatEffort`), `types/src/settings.ts` (`ProviderConfig`) |
| Probe/normalize | `core/.../claude/probe-models.ts`, `core/.../claude/adapter.ts`, `core/.../codex/adapter.ts` |
| Apply | `core/.../claude/session.ts`, `core/.../codex/session.ts`, `core/.../codex/types.ts`, `core/src/chat/chat-manager.ts`, new `resolveTuning` helper |
| API/DB | `core/src/db/schema.ts`, `core/src/db/chats.ts`, `core/src/server/routes/chats.ts`, `core/src/server/routes/settings.ts` |
| UI | `desktop/.../composer/EffortPicker.tsx`, new `FeaturesPopover.tsx`, `composer/ComposerCard.tsx`, `settings/ProviderSection.tsx`, new `lib/model-tuning.ts` |
| Tests | unit/integration per Section 7 + `e2e/tests/44-composer-config.spec.ts`, `e2e/tests/41-settings.spec.ts`, `e2e/scenarios/composer.md`, mock fixtures |
