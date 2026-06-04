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
//
// Tri-state per field — this is the contract, document it on the type:
//   undefined → not present in this partial (PATCH); leave as-is
//   null      → explicitly inherit (fall back to provider default → model default)
//   value     → concrete per-chat override
export interface SessionTuning {
  effort?: EffortLevel | null;
  fast?: boolean | null;
  ultracode?: boolean | null;
  adaptiveThinking?: boolean | null;
}
```

**Single source of truth for the boolean features.** The relationship
`featureKey ↔ model-capability field ↔ Claude settings key` is otherwise hand-wired
in ~8 places (type field, DB column, Zod, resolver clamp, Claude apply, renderer
gating…). One canonical descriptor in `@qlan-ro/mainframe-types` drives all the
**behavioral** code; the flat type/DB fields stay explicit (required for strict
typing + SQLite columns), but no logic re-derives the mapping:

```ts
// packages/types/src/adapter.ts
export const TUNABLE_FEATURES = [
  { key: 'fast',             capability: 'supportsFast',             claudeSetting: 'fastMode' },
  { key: 'ultracode',        capability: 'supportsUltracode',        claudeSetting: 'ultracode' },
  { key: 'adaptiveThinking', capability: 'supportsAdaptiveThinking', claudeSetting: 'alwaysThinkingEnabled' },
] as const satisfies ReadonlyArray<{ key: keyof SessionTuning; capability: keyof AdapterModel; claudeSetting: string }>;
```

`resolveTuning`'s boolean clamp, Claude `applyTuning`'s settings construction, and the
renderer's feature list all **iterate this** (renderer layers on `{label, desc}` only).
Effort stays separate — it's an ordered enum with clamping, not a gate.

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
- **Ultracode coercion is a resolver invariant, not just a UI nicety.** The data
  model alone allows the contradictory `effort:low + ultracode:true`. `resolveTuning`
  (Section 3) collapses this: when `ultracode` resolves truthy, `effort` is coerced
  to `'xhigh'`. This keeps spawn and live-apply in agreement regardless of how the
  values were persisted.

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
// 2. clamp to capabilities (effort result is GUARANTEED ∈ supportedEfforts, or the
//    field is simply not applied when the model lists no efforts):
//      effort  → if requested ∈ supportedEfforts: keep it
//                else if model.defaultEffort ∈ supportedEfforts: use it
//                else if supportedEfforts non-empty: highest supported ≤ requested,
//                       else the first (lowest) supported  ← never returns an unsupported level
//                else (model lists no efforts): 'medium' as a typed placeholder, and
//                       effort is NOT sent to the adapter
//      booleans → for (f of TUNABLE_FEATURES) if (!model[f.capability]) t[f.key] = false
//                 (iterates the Section-1 descriptor — no per-feature branches)
// 3. coherence:  if ultracode === true → effort = 'xhigh'   (see Section 1 invariant)
//
// Pure + total: same (chat, provider, model) always yields a valid Required<SessionTuning>.
```

`resolveTuning` is pure core logic (`core/.../resolve-tuning.ts`). Its `providerConfig`
argument comes from a **single canonical provider-config loader** (one
`getProviderConfig(adapterId)` that assembles the flat `provider.<id>.<field>` settings
rows into a typed `ProviderConfig`) — reused by the spawn seam, the `/tuning` route,
and `ProviderSection`'s read path. Do **not** scatter fresh `db.settings.get('provider', …)`
calls at each call site.

**Ownership / where it runs** (the spec's earlier "ChatManager" shorthand was loose):
- **Spawn:** `lifecycle-manager.ts` (the seam at `lifecycle-manager.ts:471` that today
  passes `effort: chat.effort` raw) calls `resolveTuning` and passes the result as
  `SessionSpawnOptions.tuning`.
- **Composer toggle & model switch:** the live path resolves and calls
  `session.applyTuning(resolved)` (model switch re-resolves against the new model so
  stale `xhigh`/`ultracode` are dropped, never sent).

**Claude — all tuning via `apply_flag_settings` (NOT the `--effort` spawn flag)**

> **Why not `--effort`?** Verified against the v2.1.156 binary: `--effort` installs a
> persistent `{kind:"effort"}` **permission layer**, and the per-turn resolver
> `kz()` applies the last effort layer *over* the app-state `effortValue`.
> `apply_flag_settings{effortLevel}` only mutates `effortValue`, so once a `--effort`
> layer exists, every later effort change (and `ultracode→xhigh`, which also writes
> `effortValue`) is **silently masked**. There is no `set_effort` control request; the
> CLI's own mid-session mechanism is the `/effort` slash command (pushes a new layer).
> Passing **no** `--effort` means no layer, so `effortValue` is the sole source of
> truth — mutable cleanly at startup and mid-session. (See
> `claude-protocol-debugger/cli-binary-internals.md`.)

Only `--model` stays a spawn arg. The envelope is built by a pure helper in
`claude/tuning.ts` (**not** inlined into the already-554-line `session.ts`):
`effortLevel` from `t.effort`, and the booleans by iterating `TUNABLE_FEATURES`
(`f.claudeSetting`), so there are no per-feature branches and adding a feature is a
one-line descriptor edit:

```ts
// claude/tuning.ts
export function tuningToFlagSettings(t: SessionTuning): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  if (t.effort !== undefined) s.effortLevel = t.effort;                       // null clears
  for (const f of TUNABLE_FEATURES) if (t[f.key] !== undefined) s[f.claudeSetting] = t[f.key];
  return s;
}
// session.applyTuning(t) = sendControlRequest({ subtype: 'apply_flag_settings',
//                                                settings: tuningToFlagSettings(t) })
```

Envelope verified against the v2.1.156 binary: the handler reads `request.settings`,
folds `model`/`effortLevel`/`ultracode` into app state (`effortValue`), merges the
rest. Mirrors the existing `setModel`/`setPermissionMode` pattern.

**Startup timing:** `ClaudeSession.spawn()` writes the resolved-tuning
`apply_flag_settings` to stdin **immediately after spawn** (and after `--resume`),
before the first user message. The CLI buffers stdin and `system:init` only fires
after the first API call, so this is the same proactive-stdin pattern already used by
the resume-permission path — provider-default effort/fast/ultracode/thinking are in
effect on the first send, not one turn late.

**Codex — `turn/start` overrides** (replaces hardcoded `reasoning_effort: null`)

Codex's `turn/start` **always** sends `collaborationMode`, and per the generated
schema `collaborationMode` *takes precedence over* top-level `model`/`effort`/
`reasoning_effort`. So effort must live in `collaborationMode.settings.reasoning_effort`
(not top-level `turn/start.effort`, which would be ignored). The knobs
`collaborationMode.settings` does **not** carry — `serviceTier`, `personality`,
`summary`, `verbosity` — go on the top-level `turn/start` params.

**Boundary: Codex-only config does not touch the shared spawn type.** `personality`,
`summary`, and `verbosity` are Codex-only and provider-level — they are **not** in
`SessionTuning` and must **not** be bolted onto `SessionSpawnOptions` (no dead
Codex-only optionals on every adapter), nor read via `db.settings` inside the session
(no settings-store leak across the adapter boundary). Instead:

- The cross-adapter slice stays in `SessionSpawnOptions.tuning: SessionTuning`
  (effort/fast → Codex `reasoning_effort`/`serviceTier`).
- A **Codex-package type** `CodexProviderTuning { personality; summary; verbosity }`
  carries the Codex-only defaults, resolved by the **Codex adapter** from the canonical
  `getProviderConfig('codex')` loader (the adapter already owns the app-server +
  `model/list`; owning its own provider knobs is the natural home).
- Turn-param assembly lives in a `codex/turn-config.ts` helper (**not** inlined into
  the already-435-line `session.ts`):

```ts
// codex/turn-config.ts — pure
collaborationMode.settings = { model, reasoning_effort: tuning.effort, developer_instructions: null };
turnParams.serviceTier = tuning.fast ? 'fast' : 'flex';   // only when model.supportsFast
turnParams.personality = codexCfg.personality;            // only when model.supportsPersonality
turnParams.summary = codexCfg.summary; turnParams.verbosity = codexCfg.verbosity;
```

Exact field names/enums to be re-verified against `codex app-server generate-ts`
during implementation. Codex `applyTuning()` updates the session's pending tuning used
by the next `turn/start` (no separate control message — per-turn is the protocol's own
mechanism).

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
  text — **exhaustive over the union** (`none`, `minimal`, `low`, `medium`, `high`,
  `xhigh` → "Extra-high", `max` → "Maximum"). Only levels present in
  `supportedEfforts` are rendered, so `none`/`minimal` stay hidden for today's models
  but the `Record` stays type-complete.
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

- One row per supported feature. The renderer does **not** redefine the key↔capability
  mapping — it layers display strings onto the canonical `TUNABLE_FEATURES` descriptor
  (Section 1), in the shared `lib/model-tuning.ts`:
  ```ts
  const FEATURE_LABELS: Record<FeatureKey, { label: string; desc: string }> = {
    fast:             { label: 'Fast mode',         desc: 'Faster output; may draw on usage credits' },
    ultracode:        { label: 'Ultracode',         desc: 'xhigh effort + dynamic workflows' },
    adaptiveThinking: { label: 'Adaptive thinking', desc: 'Claude decides when/how much to think' },
  };
  // visible = TUNABLE_FEATURES.filter(f => model[f.capability])
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

**`ProviderSection.tsx` must be decomposed, not grown.** It is 174 lines today and
these additions (effort dropdown + N feature toggles + a 3-field Codex block + gating)
would push it past the repo's 300-line limit and tangle four concerns in one file.
Extract two subcomponents, both capability-gated off `config.defaultModel`'s model:
- **`<ProviderTuningDefaults>`** — Default Effort dropdown (options from the model's
  `supportedEfforts`, shared `EFFORT_META`) + a `<Toggle>` per supported feature
  (iterating `TUNABLE_FEATURES`). Adapter-agnostic; reused styling with the composer.
- **`<CodexTuningDefaults>`** — the Codex-only block (gated `adapterId === 'codex'`):
  Personality (additionally gated by `model.supportsPersonality`), Reasoning Summary,
  Verbosity dropdowns. Mirrors the `CodexProviderTuning` type from Section 3.

`ProviderSection` just composes these alongside its existing fields. All write through
the existing `update({...})` → `updateProviderSettings` path. `data-testid`s:
`providers-${adapterId}-default-effort`, `providers-${adapterId}-default-feature-${key}`,
`providers-${adapterId}-personality`, `providers-${adapterId}-reasoning-summary`,
`providers-${adapterId}-verbosity`.

**Shared-helper extraction** (CLAUDE.md "extract if 3+ consumers"): `EFFORT_META`,
`FEATURE_LABELS`, and the gating predicates live in `lib/model-tuning.ts` (layered on
the canonical `TUNABLE_FEATURES`), imported by `EffortPicker`, `FeaturesPopover`,
`ProviderTuningDefaults`, and `CodexTuningDefaults`.

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
  effort:           z.enum(['none','minimal','low','medium','high','xhigh','max']).nullable().optional(),  // = EffortLevel; keep in sync
  fast:             z.boolean().nullable().optional(),
  ultracode:        z.boolean().nullable().optional(),
  adaptiveThinking: z.boolean().nullable().optional(),
});
```

- **One internal helper, both routes.** Extract `applyChatTuning(chatId, partial:
  SessionTuning)` (persist → `syncChatFields` → live-apply). `/tuning` passes the
  validated body; the existing `PATCH /api/chats/:id/effort` **stays** (enum widened to
  the full set, for the **mobile submodule**) and simply calls
  `applyChatTuning(id, { effort })`. No copy-pasted `db.update`/`syncChatFields`
  sequence — keeps `chats.ts` (251 lines) under 300.
- **Drop the `as Chat['effort']` cast.** The current `/effort` handler casts to push
  `null` through an update loop that skips `undefined`. Don't scale that across four
  fields — make the DB update layer distinguish "key absent" (skip) from "key present
  & `null`" (write NULL) explicitly **once** (`'effort' in partial`), so the tri-state
  is honored without casts.
- **Live-apply wiring (correct owner):** `applyChatTuning` resolves the live session
  through the session registry (the same place `lifecycle-manager` holds active
  sessions) and calls `session.applyTuning(resolved)`; no active session → no-op
  (applied at next spawn). (Earlier "ChatManager" shorthand was loose — the active
  session lives on the lifecycle layer.)

**Provider settings** — key-value store, no migration. Extend the provider PUT
route's Zod to validate the new enum fields.

**Spawn path** — `SessionSpawnOptions.effort` → `tuning?: SessionTuning`;
**`lifecycle-manager.ts`** (seam at `:471`) builds it via
`resolveTuning(chat, getProviderConfig(adapterId), model)` at spawn — resolving the
`null`/inherit values against the live provider defaults and clamping to the model.

## Testing (Section 7)

**Probe / normalize (core)**
- `claude-probe-models.test.ts` — extend: effort array, adaptive-thinking, fast,
  derived ultracode (assert Sonnet-without-xhigh → ultracode false).
- New `codex-list-models.test.ts` — full `Model` → `AdapterModel`: effort array,
  `defaultEffort`, `supportsFast`, `supportsPersonality`, `isDefault`, **`hidden`
  filtered**, `[]` on probe failure.

**Apply layer (core)** — highest-value (new behavior), tested on the pure helpers
- `claude/tuning.ts` `tuningToFlagSettings` — exact `apply_flag_settings` payload from
  a `SessionTuning` (descriptor-driven keys; `null` clears); Claude spawn asserts only
  `--model`, **no `--effort`** (regression for the masking-layer finding) + startup
  `apply_flag_settings` written proactively before first message.
- `codex/turn-config.ts` — resolved effort lands in
  `collaborationMode.settings.reasoning_effort` (no longer `null`);
  `serviceTier:'fast'|'flex'`; `CodexProviderTuning` (personality/summary/verbosity)
  on top-level params and **never** sourced from the shared spawn options.
- `resolve-tuning.ts` — precedence table across all four fields **plus**: capability
  clamping (effort not in `supportedEfforts` → guaranteed-supported fallback;
  booleans forced false via `TUNABLE_FEATURES` when unsupported), ultracode→xhigh
  coercion, and model-switch re-resolve (drops now-invalid stored values).
- `applyChatTuning` — one helper; assert `/effort` and `/tuning` both route through it
  (no duplicated persist/sync/apply); tri-state `'key' in partial` honored with no casts.

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
| Types | `types/src/adapter.ts` (`AdapterModel`, `AdapterSession`, `SessionSpawnOptions`, `TUNABLE_FEATURES`), `types/src/chat.ts` (`SessionTuning`, `Chat`, `ChatEffort`), `types/src/settings.ts` (`ProviderConfig`) |
| Probe/normalize | `core/.../claude/probe-models.ts`, `core/.../claude/adapter.ts`, `core/.../codex/adapter.ts` |
| Resolve/apply | **new** `core/src/chat/resolve-tuning.ts`, **new** `core/.../claude/tuning.ts`, **new** `core/.../codex/turn-config.ts` (+ `CodexProviderTuning` type), `core/.../codex/types.ts`; thin call-sites in `claude/session.ts`, `codex/session.ts`, `lifecycle-manager.ts`; canonical `getProviderConfig(adapterId)` loader |
| API/DB | `core/src/db/schema.ts`, `core/src/db/chats.ts` (explicit `'key' in partial` null handling), `core/src/server/routes/chats.ts` (shared `applyChatTuning`), `core/src/server/routes/settings.ts` |
| UI | `desktop/.../composer/EffortPicker.tsx`, **new** `FeaturesPopover.tsx`, `composer/ComposerCard.tsx`, **new** `lib/model-tuning.ts`; `settings/ProviderSection.tsx` decomposed → **new** `ProviderTuningDefaults.tsx` + **new** `CodexTuningDefaults.tsx` |
| Tests | unit/integration per Section 7 + `e2e/tests/44-composer-config.spec.ts`, `e2e/tests/41-settings.spec.ts`, `e2e/scenarios/composer.md`, mock fixtures |

## Implementation guardrails (from the code-quality review)

- **No file crosses 300 lines.** `claude/session.ts` (554) and `codex/session.ts`
  (435) are already over — the tuning/turn-config logic goes in **new** helper modules
  they call, never inlined. `ProviderSection.tsx` (174) is decomposed into the two
  subcomponents above rather than grown. `chats.ts` (251) stays under 300 via the
  shared `applyChatTuning` helper.
- **One source of truth for boolean features:** `TUNABLE_FEATURES`. Resolver clamp,
  Claude flag-settings mapping, and renderer gating all iterate it — no per-feature
  branches, no re-declared key↔capability maps. Adding a feature = one descriptor row
  (+ its flat type/DB field + a label).
- **No boundary leaks:** Codex-only config (`CodexProviderTuning`) stays in the Codex
  package and is resolved by the Codex adapter; it never lands on the shared
  `SessionSpawnOptions`, and the session never reads `db.settings` directly. Provider
  config is read through one `getProviderConfig` loader.
- **No casts for the tri-state:** the DB update layer keys off `'<field>' in partial`
  to honor `undefined` vs `null` vs value — no `as Chat[...]` casts.
