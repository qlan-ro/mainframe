# Model & Harness Config Flags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-model effort levels + the fast / ultracode / adaptive-thinking feature flags (and Codex personality / reasoning-summary / verbosity) in the composer and provider settings, driven dynamically from each adapter's advertised capabilities instead of hardcoded lists.

**Architecture:** One canonical `AdapterModel` carries dynamic capability data; a `TUNABLE_FEATURES` descriptor is the single source of truth for the boolean features; a pure `resolveTuning` resolver computes effective config (precedence → capability clamp → ultracode coercion); each adapter translates it natively (Claude `apply_flag_settings`, Codex `turn/start`). Composer knobs are per-chat (nullable = inherit); provider settings hold defaults.

**Tech Stack:** TypeScript (strict, NodeNext), pnpm workspaces, better-sqlite3, Electron + React, Vitest, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-06-04-model-config-flags-design.md` (Codex-approved + thermo-nuclear-reviewed).

**Conventions for every task:** run a single test file with `pnpm --filter <pkg> test <path>`; typecheck a package with `pnpm --filter <pkg> typecheck`; commit on a branch (already on `feat/model-config-flags`); never edit `packages/mobile` (submodule, out of scope).

---

## File map (decomposition locked here)

| Layer | File | Responsibility |
|-------|------|----------------|
| types | `packages/types/src/adapter.ts` | `EffortLevel`, `AdapterModel` caps, `TUNABLE_FEATURES`, `FeatureKey`, `SessionSpawnOptions.tuning`, `AdapterSession.applyTuning` |
| types | `packages/types/src/chat.ts` | `SessionTuning`, `ResolvedTuning`, `Chat` fields, `ChatEffort = EffortLevel` |
| types | `packages/types/src/settings.ts` | `ProviderConfig` defaults + Codex knobs |
| core | `packages/core/src/chat/resolve-tuning.ts` *(new)* | pure precedence + clamp + coercion |
| core | `packages/core/src/settings/provider-config.ts` *(new)* | canonical `getProviderConfig(db, adapterId)` loader |
| core | `packages/core/src/plugins/builtin/claude/probe-models.ts` | map CLI model info → caps |
| core | `packages/core/src/plugins/builtin/claude/adapter.ts` | static catalog caps |
| core | `packages/core/src/plugins/builtin/claude/tuning.ts` *(new)* | `tuningToFlagSettings` |
| core | `packages/core/src/plugins/builtin/claude/session.ts` | spawn (no `--effort`), startup apply, `applyTuning`, `setModel` re-resolve |
| core | `packages/core/src/plugins/builtin/codex/adapter.ts` | map `model/list` → caps, filter hidden |
| core | `packages/core/src/plugins/builtin/codex/turn-config.ts` *(new)* | `CodexProviderTuning`, build turn/start config |
| core | `packages/core/src/plugins/builtin/codex/session.ts` | thread tuning into `turn/start`, `applyTuning` |
| core | `packages/core/src/db/schema.ts` | `fast` / `ultracode` / `adaptive_thinking` columns |
| core | `packages/core/src/db/chats.ts` | column map + parse (tri-state) |
| core | `packages/core/src/server/routes/chats.ts` | `applyChatTuning` helper, `/tuning`, `/effort` delegate |
| core | `packages/core/src/server/routes/settings.ts` + `schemas.ts` | provider Zod for new fields |
| core | `packages/core/src/chat/lifecycle-manager.ts` | spawn seam uses `resolveTuning` |
| desktop | `packages/desktop/src/renderer/lib/model-tuning.ts` *(new)* | `EFFORT_META`, `FEATURE_LABELS`, gating |
| desktop | `.../composer/EffortPicker.tsx` | dynamic effort options |
| desktop | `.../composer/FeaturesPopover.tsx` *(new)* | capability-gated `<Toggle>` rows |
| desktop | `.../composer/ComposerCard.tsx` | mount popover |
| desktop | `.../lib/api/*` | `setChatTuning` client |
| desktop | `.../settings/ProviderTuningDefaults.tsx` *(new)* | default effort + feature toggles |
| desktop | `.../settings/CodexTuningDefaults.tsx` *(new)* | personality / summary / verbosity |
| desktop | `.../settings/ProviderSection.tsx` | compose the two |
| e2e | `packages/e2e/...` | mock caps fixtures + specs |

Execution order = phases A→M below (each depends on the prior layer).

---

## Phase A — Types & canonical descriptor

### Task A1: EffortLevel + AdapterModel capabilities + TUNABLE_FEATURES

**Files:**
- Modify: `packages/types/src/adapter.ts`
- Modify: `packages/types/src/chat.ts`

- [ ] **Step 1: Add `EffortLevel`, the capability fields, and the descriptor to `adapter.ts`**

Replace the existing `AdapterModel` interface (the one with `supportsEffort?/supportsFastMode?/supportsAutoMode?`) with:

```ts
/**
 * Full union across both CLIs. Codex ReasoningEffort = none/minimal/low/medium/high/xhigh;
 * Claude adds 'max'. The per-model `supportedEfforts` array is the runtime gate.
 */
export type EffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AdapterModel {
  id: string;
  label: string;
  description?: string;
  contextWindow?: number;
  isDefault?: boolean;
  /** Dynamic, per-model. Empty/absent → model has no effort control. */
  supportedEfforts?: EffortLevel[];
  defaultEffort?: EffortLevel;
  supportsFast?: boolean;
  supportsUltracode?: boolean;
  supportsAdaptiveThinking?: boolean;
  supportsPersonality?: boolean;
}

/**
 * Single source of truth for the boolean tuning features. Resolver clamp, Claude
 * flag-settings mapping, and renderer gating all iterate this — no per-feature branches.
 */
export const TUNABLE_FEATURES = [
  { key: 'fast', capability: 'supportsFast', claudeSetting: 'fastMode', providerDefault: 'defaultFast' },
  { key: 'ultracode', capability: 'supportsUltracode', claudeSetting: 'ultracode', providerDefault: 'defaultUltracode' },
  { key: 'adaptiveThinking', capability: 'supportsAdaptiveThinking', claudeSetting: 'alwaysThinkingEnabled', providerDefault: 'defaultAdaptiveThinking' },
] as const;

export type FeatureKey = (typeof TUNABLE_FEATURES)[number]['key'];
```

- [ ] **Step 2: Replace `effort` on `SessionSpawnOptions` with `tuning`**

In `adapter.ts`, change the `SessionSpawnOptions` interface body field:

```ts
// remove: effort?: import('./chat.js').ChatEffort;
tuning?: import('./chat.js').SessionTuning;
```

- [ ] **Step 3: Add `applyTuning` to `AdapterSession`**

In the `AdapterSession` interface, add:

```ts
/** Apply runtime tuning to a live session. No-op fields are omitted by the caller. */
applyTuning?(tuning: import('./chat.js').SessionTuning): Promise<void>;
```

- [ ] **Step 4: Add the tuning types to `chat.ts`**

In `packages/types/src/chat.ts`, replace `export type ChatEffort = 'low' | 'medium' | 'high';` and the `effort?: ChatEffort;` field on `Chat` with:

```ts
import type { EffortLevel } from './adapter.js';
export type ChatEffort = EffortLevel; // back-compat alias for existing imports

/**
 * Per-chat / per-session tuning override. Tri-state per field:
 *   undefined → absent from this partial (PATCH); leave as-is
 *   null      → explicitly inherit (provider default → model default)
 *   value     → concrete override
 */
export interface SessionTuning {
  effort?: EffortLevel | null;
  fast?: boolean | null;
  ultracode?: boolean | null;
  adaptiveThinking?: boolean | null;
}

/** Fully resolved, capability-clamped config. `effort: null` → model has no effort control. */
export interface ResolvedTuning {
  effort: EffortLevel | null;
  fast: boolean;
  ultracode: boolean;
  adaptiveThinking: boolean;
}
```

On the `Chat` interface, replace the single effort field with:

```ts
effort?: EffortLevel | null;
fast?: boolean | null;
ultracode?: boolean | null;
adaptiveThinking?: boolean | null;
```

- [ ] **Step 5: Add `ProviderConfig` fields in `settings.ts`**

```ts
// inside ProviderConfig:
defaultEffort?: EffortLevel;
defaultFast?: 'true' | 'false';
defaultUltracode?: 'true' | 'false';
defaultAdaptiveThinking?: 'true' | 'false';
personality?: 'none' | 'friendly' | 'pragmatic';
reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
verbosity?: 'low' | 'medium' | 'high';
```

Add `import type { EffortLevel } from './adapter.js';` at the top of `settings.ts`.

- [ ] **Step 6: Typecheck the types package**

Run: `pnpm --filter @qlan-ro/mainframe-types typecheck`
Expected: PASS (it will surface downstream breakages only in other packages, which later phases fix).

- [ ] **Step 7: Commit**

```bash
git add packages/types/src
git commit -m "feat(types): EffortLevel, SessionTuning, TUNABLE_FEATURES capability model"
```

---

## Phase B — Pure resolver

### Task B1: `resolveTuning`

**Files:**
- Create: `packages/core/src/chat/resolve-tuning.ts`
- Test: `packages/core/src/__tests__/resolve-tuning.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveTuning } from '../chat/resolve-tuning.js';
import type { AdapterModel } from '@qlan-ro/mainframe-types';

const opus: AdapterModel = {
  id: 'opus', label: 'Opus',
  supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  supportsFast: true, supportsUltracode: true, supportsAdaptiveThinking: true,
};
const sonnet: AdapterModel = {
  id: 'sonnet', label: 'Sonnet',
  supportedEfforts: ['low', 'medium', 'high', 'max'], // no xhigh
  supportsFast: true,
};
const haiku: AdapterModel = { id: 'haiku', label: 'Haiku' }; // no effort, no caps

describe('resolveTuning', () => {
  it('uses chat override over provider default over model default', () => {
    const r = resolveTuning({ effort: 'high' }, { defaultEffort: 'low' }, opus);
    expect(r.effort).toBe('high');
  });

  it('falls back provider → model default when chat is null/absent', () => {
    expect(resolveTuning({ effort: null }, { defaultEffort: 'low' }, opus).effort).toBe('low');
    expect(resolveTuning({}, {}, { ...opus, defaultEffort: 'medium' }).effort).toBe('medium');
  });

  it('clamps unsupported effort to a supported level, never out of range', () => {
    // xhigh requested on Sonnet (no xhigh) → highest supported <= xhigh = 'high'
    expect(resolveTuning({ effort: 'xhigh' }, {}, sonnet).effort).toBe('high');
  });

  it('returns effort=null when the model has no effort control', () => {
    expect(resolveTuning({ effort: 'high' }, {}, haiku).effort).toBeNull();
  });

  it('forces booleans false when the model lacks the capability', () => {
    const r = resolveTuning({ fast: true, ultracode: true, adaptiveThinking: true }, {}, sonnet);
    expect(r).toMatchObject({ fast: true, ultracode: false, adaptiveThinking: false });
  });

  it('decodes provider-default booleans (string "true"/"false")', () => {
    expect(resolveTuning({}, { defaultFast: 'true' }, opus).fast).toBe(true);
    expect(resolveTuning({ fast: false }, { defaultFast: 'true' }, opus).fast).toBe(false);
  });

  it('coerces effort to xhigh when ultracode resolves true', () => {
    const r = resolveTuning({ effort: 'low', ultracode: true }, {}, opus);
    expect(r.ultracode).toBe(true);
    expect(r.effort).toBe('xhigh');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test resolve-tuning`
Expected: FAIL ("Cannot find module '../chat/resolve-tuning.js'").

- [ ] **Step 3: Implement `resolve-tuning.ts`**

```ts
import type {
  AdapterModel, EffortLevel, ResolvedTuning, SessionTuning, FeatureKey,
} from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';

const EFFORT_ORDER: EffortLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const rank = (e: EffortLevel): number => EFFORT_ORDER.indexOf(e);

/** Provider config slice the resolver reads (decoded lazily here). */
export interface ProviderTuningDefaults {
  defaultEffort?: EffortLevel;
  defaultFast?: 'true' | 'false';
  defaultUltracode?: 'true' | 'false';
  defaultAdaptiveThinking?: 'true' | 'false';
}

function clampEffort(requested: EffortLevel, model: AdapterModel): EffortLevel | null {
  const supported = model.supportedEfforts ?? [];
  if (supported.length === 0) return null; // model has no effort control
  if (supported.includes(requested)) return requested;
  if (model.defaultEffort && supported.includes(model.defaultEffort)) return model.defaultEffort;
  const below = supported
    .filter((e) => rank(e) <= rank(requested))
    .sort((a, b) => rank(b) - rank(a));
  if (below[0]) return below[0];
  return [...supported].sort((a, b) => rank(a) - rank(b))[0]!; // lowest supported
}

function firstDefined<T>(...vals: (T | null | undefined)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

export function resolveTuning(
  chat: SessionTuning,
  provider: ProviderTuningDefaults,
  model: AdapterModel,
): ResolvedTuning {
  const requestedEffort = firstDefined(chat.effort, provider.defaultEffort, model.defaultEffort) ?? 'medium';
  const out: ResolvedTuning = {
    effort: clampEffort(requestedEffort, model),
    fast: false,
    ultracode: false,
    adaptiveThinking: false,
  };

  for (const f of TUNABLE_FEATURES) {
    const providerRaw = provider[f.providerDefault as keyof ProviderTuningDefaults];
    const providerBool = providerRaw === undefined ? undefined : providerRaw === 'true';
    const requested = firstDefined<boolean>(chat[f.key as keyof SessionTuning] as boolean | null | undefined, providerBool);
    out[f.key as FeatureKey] = model[f.capability] ? Boolean(requested) : false;
  }

  if (out.ultracode) out.effort = 'xhigh';
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test resolve-tuning`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/resolve-tuning.ts packages/core/src/__tests__/resolve-tuning.test.ts
git commit -m "feat(core): resolveTuning — precedence, capability clamp, ultracode coercion"
```

---

## Phase C — Probe / normalize

### Task C1: Claude probe captures capabilities

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/probe-models.ts`
- Test: `packages/core/src/__tests__/claude-probe-models.test.ts`

- [ ] **Step 1: Add failing assertions to the existing probe test**

Append a test that feeds a fake initialize payload through the exported `mapModelInfo` (export it if not already). Add to the test file:

```ts
import { mapModelInfo } from '../plugins/builtin/claude/probe-models.js';

describe('mapModelInfo capabilities', () => {
  it('maps effort levels, fast, adaptive-thinking, derives ultracode', () => {
    const m = mapModelInfo({
      value: 'default', displayName: 'Default',
      description: 'Opus 4.8 with 1M context · Most capable',
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true, supportsFastMode: true,
    });
    expect(m.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(m.supportsFast).toBe(true);
    expect(m.supportsAdaptiveThinking).toBe(true);
    expect(m.supportsUltracode).toBe(true); // derived from xhigh
  });

  it('hides ultracode for models without xhigh (Sonnet)', () => {
    const m = mapModelInfo({
      value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6',
      supportedEffortLevels: ['low', 'medium', 'high', 'max'], supportsFastMode: true,
    });
    expect(m.supportsUltracode).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test claude-probe-models`
Expected: FAIL (`mapModelInfo` not exported / fields undefined).

- [ ] **Step 3: Update `CliModelInfo` and `mapModelInfo`**

In `probe-models.ts`, extend the interface and mapping, and `export` `mapModelInfo`:

```ts
interface CliModelInfo {
  value: string;
  displayName: string;
  description?: string;
  supportedEffortLevels?: import('@qlan-ro/mainframe-types').EffortLevel[];
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
}

export function mapModelInfo(info: CliModelInfo): AdapterModel {
  const identity = extractIdentity(info.description);
  let label = info.displayName;
  if (info.value === 'default') {
    const bare = identity?.split(/\s+with\s+/i)[0]?.trim();
    label = bare ? `Default - ${bare}` : 'Default';
  } else if (identity) {
    label = identity;
  }
  const model: AdapterModel = { id: info.value, label };
  if (info.description) model.description = info.description;
  if (info.supportedEffortLevels?.length) {
    model.supportedEfforts = info.supportedEffortLevels;
    if (info.supportedEffortLevels.includes('xhigh')) model.supportsUltracode = true;
  }
  if (info.supportsFastMode) model.supportsFast = true;
  if (info.supportsAdaptiveThinking) model.supportsAdaptiveThinking = true;
  if (info.value === 'default') model.isDefault = true;
  return model;
}
```

(Update the parsing call site that reads `rawModels` to keep using `mapModelInfo`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test claude-probe-models`
Expected: PASS.

- [ ] **Step 5: Update the static Claude catalog**

In `packages/core/src/plugins/builtin/claude/adapter.ts`, replace each model's `supportsEffort/supportsFastMode/supportsAutoMode` booleans with the new shape. For the `default` and Opus entries:

```ts
{
  id: 'default', label: 'Default - Opus 4.8', description: 'Opus 4.8 with 1M context',
  contextWindow: EXTENDED_CONTEXT_WINDOW,
  supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  supportsFast: true, supportsUltracode: true, supportsAdaptiveThinking: true, isDefault: true,
},
```

For Sonnet-class entries use `supportedEfforts: ['low','medium','high','max']` (no ultracode/adaptive). For Haiku entries leave caps unset. Update `enrichWithContextWindow` only if it referenced removed fields (it does not).

- [ ] **Step 6: Typecheck core**

Run: `pnpm --filter @qlan-ro/mainframe-core typecheck`
Expected: errors remaining only in session/route files fixed in later phases. Fix any in `adapter.ts`/`probe-models.ts` now.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/probe-models.ts \
        packages/core/src/plugins/builtin/claude/adapter.ts \
        packages/core/src/__tests__/claude-probe-models.test.ts
git commit -m "feat(core): claude probe captures effort levels, fast, adaptive-thinking"
```

### Task C2: Codex `listModels` maps the full Model

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/adapter.ts`
- Modify: `packages/core/src/plugins/builtin/codex/types.ts`
- Test: `packages/core/src/plugins/builtin/codex/__tests__/list-models.test.ts` *(new)*

- [ ] **Step 1: Extend the Codex `ModelInfo` type**

In `codex/types.ts`, replace `ModelInfo` with the real shape:

```ts
export interface ReasoningEffortOption { reasoningEffort: import('@qlan-ro/mainframe-types').EffortLevel; description: string; }
export interface ModelInfo {
  id: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  supportedReasoningEfforts?: ReasoningEffortOption[];
  defaultReasoningEffort?: import('@qlan-ro/mainframe-types').EffortLevel;
  additionalSpeedTiers?: string[];
  supportsPersonality?: boolean;
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { mapCodexModel } from '../adapter.js';

describe('mapCodexModel', () => {
  it('maps efforts, default, fast tier, personality, isDefault', () => {
    const m = mapCodexModel({
      id: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Frontier',
      hidden: false, isDefault: false, supportsPersonality: true,
      additionalSpeedTiers: ['fast'], defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: '' }, { reasoningEffort: 'medium', description: '' },
        { reasoningEffort: 'high', description: '' }, { reasoningEffort: 'xhigh', description: '' },
      ],
    });
    expect(m.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(m.defaultEffort).toBe('medium');
    expect(m.supportsFast).toBe(true);
    expect(m.supportsPersonality).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test codex/__tests__/list-models`
Expected: FAIL (`mapCodexModel` not exported).

- [ ] **Step 4: Add `mapCodexModel` and use it (filtering hidden)**

In `codex/adapter.ts`, add the exported mapper and rewrite `listModels`:

```ts
export function mapCodexModel(m: import('./types.js').ModelInfo): AdapterModel {
  const model: AdapterModel = { id: m.id, label: m.displayName ?? m.id };
  if (m.description) model.description = m.description;
  if (m.isDefault) model.isDefault = true;
  if (m.supportedReasoningEfforts?.length) {
    model.supportedEfforts = m.supportedReasoningEfforts.map((e) => e.reasoningEffort);
  }
  if (m.defaultReasoningEffort) model.defaultEffort = m.defaultReasoningEffort;
  if (m.additionalSpeedTiers?.includes('fast')) model.supportsFast = true;
  if (m.supportsPersonality) model.supportsPersonality = true;
  return model;
}

// in listModels():
const result = await client.request<ModelListResult>('model/list');
return result.data.filter((m) => !m.hidden).map(mapCodexModel);
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test codex/__tests__/list-models`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/adapter.ts \
        packages/core/src/plugins/builtin/codex/types.ts \
        packages/core/src/plugins/builtin/codex/__tests__/list-models.test.ts
git commit -m "feat(core): codex listModels maps full capability set, filters hidden"
```

---

## Phase D — Persistence

### Task D1: DB columns + chat mapping (tri-state)

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Modify: `packages/core/src/db/chats.ts`
- Test: `packages/core/src/__tests__/db/chats.test.ts`

- [ ] **Step 1: Add the migration columns**

In `schema.ts`, after the existing `effort` block:

```ts
if (!cols.some((c) => c.name === 'fast')) db.exec('ALTER TABLE chats ADD COLUMN fast INTEGER');
if (!cols.some((c) => c.name === 'ultracode')) db.exec('ALTER TABLE chats ADD COLUMN ultracode INTEGER');
if (!cols.some((c) => c.name === 'adaptive_thinking')) db.exec('ALTER TABLE chats ADD COLUMN adaptive_thinking INTEGER');
```

- [ ] **Step 2: Write failing round-trip test**

Add to `db/chats.test.ts`:

```ts
it('round-trips tuning fields incl. null vs false', () => {
  const id = repo.create(/* existing helper args */);
  repo.update(id, { fast: true, ultracode: false, adaptiveThinking: null, effort: 'xhigh' });
  const c = repo.get(id)!;
  expect(c.fast).toBe(true);
  expect(c.ultracode).toBe(false);
  expect(c.adaptiveThinking).toBeNull();
  expect(c.effort).toBe('xhigh');
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test db/chats`
Expected: FAIL (fields undefined; columns unmapped).

- [ ] **Step 4: Extend the column map + row parse**

In `chats.ts` `updateColumnMap`, after the `effort` entry add (boolean transform handles null vs 0/1):

```ts
fast: { column: 'fast', transform: (v) => (v == null ? null : v ? 1 : 0) },
ultracode: { column: 'ultracode', transform: (v) => (v == null ? null : v ? 1 : 0) },
adaptiveThinking: { column: 'adaptive_thinking', transform: (v) => (v == null ? null : v ? 1 : 0) },
```

Add a `parseNullableBool` helper and use it in `mapRow` (next to `effort: parseEffort(row.effort)`):

```ts
const parseNullableBool = (v: unknown): boolean | null => (v == null ? null : Boolean(v));
// in the returned object:
fast: parseNullableBool(row.fast),
ultracode: parseNullableBool(row.ultracode),
adaptiveThinking: parseNullableBool(row.adaptive_thinking),
```

Add `fast`, `ultracode`, `adaptive_thinking` to the `RawChatRow` type and the `SELECT`/row interface as `number | null`. Update `parseEffort` return type to `EffortLevel | null`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test db/chats`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/chats.ts packages/core/src/__tests__/db/chats.test.ts
git commit -m "feat(core): persist fast/ultracode/adaptiveThinking (nullable = inherit)"
```

---

## Phase E — Provider config loader + API

### Task E1: Canonical `getProviderConfig`

**Files:**
- Create: `packages/core/src/settings/provider-config.ts`
- Test: `packages/core/src/__tests__/provider-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { getProviderConfig } from '../settings/provider-config.js';

const fakeDb = (rows: Record<string, string>) => ({
  settings: { get: (ns: string, key: string) => rows[`${ns}:${key}`] ?? null },
});

describe('getProviderConfig', () => {
  it('assembles flat provider.* settings into a typed ProviderConfig', () => {
    const db = fakeDb({
      'provider:claude.defaultModel': 'opus',
      'provider:claude.defaultEffort': 'high',
      'provider:claude.defaultFast': 'true',
    }) as never;
    const cfg = getProviderConfig(db, 'claude');
    expect(cfg.defaultModel).toBe('opus');
    expect(cfg.defaultEffort).toBe('high');
    expect(cfg.defaultFast).toBe('true');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test provider-config`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the loader**

```ts
import type { ProviderConfig } from '@qlan-ro/mainframe-types';

interface SettingsReader { settings: { get(ns: string, key: string): string | null } }
const FIELDS = [
  'defaultModel', 'defaultMode', 'defaultPlanMode', 'executablePath', 'systemPrompt',
  'defaultEffort', 'defaultFast', 'defaultUltracode', 'defaultAdaptiveThinking',
  'personality', 'reasoningSummary', 'verbosity',
] as const;

export function getProviderConfig(db: SettingsReader, adapterId: string): ProviderConfig {
  const cfg: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = db.settings.get('provider', `${adapterId}.${f}`);
    if (v != null) cfg[f] = v;
  }
  return cfg as ProviderConfig;
}
```

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-core test provider-config` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings/provider-config.ts packages/core/src/__tests__/provider-config.test.ts
git commit -m "feat(core): canonical getProviderConfig loader"
```

### Task E2: `applyChatTuning` helper + `/tuning` route + `/effort` delegate

**Files:**
- Modify: `packages/core/src/server/routes/chats.ts`
- Test: `packages/core/src/__tests__/routes/chats.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `routes/chats.test.ts` (follow the existing supertest/app harness in that file):

```ts
it('PATCH /tuning persists a subset and clears with null', async () => {
  const res = await request(app).patch(`/api/chats/${chatId}/tuning`).send({ fast: true, effort: 'xhigh' });
  expect(res.status).toBe(200);
  expect(res.body.data.fast).toBe(true);
  expect(res.body.data.effort).toBe('xhigh');
  const res2 = await request(app).patch(`/api/chats/${chatId}/tuning`).send({ effort: null });
  expect(res2.body.data.effort).toBeNull();
});

it('PATCH /tuning rejects bad effort', async () => {
  const res = await request(app).patch(`/api/chats/${chatId}/tuning`).send({ effort: 'turbo' });
  expect(res.status).toBe(400);
});

it('PATCH /effort still works (widened enum) and routes through the same path', async () => {
  const res = await request(app).patch(`/api/chats/${chatId}/effort`).send({ effort: 'max' });
  expect(res.status).toBe(200);
  expect(res.body.data.effort).toBe('max');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test routes/chats`
Expected: FAIL (no `/tuning`; `/effort` rejects `max`).

- [ ] **Step 3: Implement the shared helper + routes**

In `routes/chats.ts`, replace the `effortSchema` + `/effort` handler with:

```ts
const EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const tuningSchema = z.object({
  effort: z.enum(EFFORT_VALUES).nullable().optional(),
  fast: z.boolean().nullable().optional(),
  ultracode: z.boolean().nullable().optional(),
  adaptiveThinking: z.boolean().nullable().optional(),
});

// One code path for both routes. `partial` keys are exactly the present fields,
// so undefined-vs-null tri-state is preserved by db.chats.update (skips undefined,
// writes null). No casts.
function applyChatTuning(chatId: string, partial: SessionTuning): Chat | null {
  ctx.db.chats.update(chatId, partial);
  const chat = ctx.db.chats.get(chatId);
  if (!chat) return null;
  ctx.chats?.syncChatFields?.(chatId, partial);
  void ctx.chats?.applyTuning?.(chatId, partial); // fire-and-forget live apply; logs internally
  return chat;
}

router.patch('/api/chats/:id/tuning', (req: Request, res: Response) => {
  const chatId = param(req, 'id');
  const parsed = tuningSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'invalid tuning payload' });
    return;
  }
  try {
    const chat = applyChatTuning(chatId, parsed.data);
    if (!chat) { res.status(404).json({ success: false, error: 'Chat not found' }); return; }
    res.json({ success: true, data: chat });
  } catch (err) {
    logger.warn({ err, chatId }, 'Failed to update tuning');
    res.status(500).json({ success: false, error: 'Operation failed' });
  }
});

// Back-compat for the mobile submodule: a strict subset that delegates.
const effortOnlySchema = z.object({ effort: z.enum(EFFORT_VALUES).nullable() });
router.patch('/api/chats/:id/effort', (req: Request, res: Response) => {
  const chatId = param(req, 'id');
  const parsed = effortOnlySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'effort must be a valid level or null' });
    return;
  }
  try {
    const chat = applyChatTuning(chatId, { effort: parsed.data.effort });
    if (!chat) { res.status(404).json({ success: false, error: 'Chat not found' }); return; }
    res.json({ success: true, data: chat });
  } catch (err) {
    logger.warn({ err, chatId }, 'Failed to update effort');
    res.status(500).json({ success: false, error: 'Operation failed' });
  }
});
```

Add `import type { Chat, SessionTuning } from '@qlan-ro/mainframe-types';` if not present. Add a `applyTuning?(chatId: string, partial: SessionTuning): Promise<void>` optional method to the `ctx.chats` interface type (wired in Phase H).

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-core test routes/chats` → PASS.

- [ ] **Step 5: Provider settings Zod**

In `server/routes/schemas.ts`, extend the provider settings schema with the new optional fields:

```ts
defaultEffort: z.enum(['none','minimal','low','medium','high','xhigh','max']).optional(),
defaultFast: z.enum(['true', 'false']).optional(),
defaultUltracode: z.enum(['true', 'false']).optional(),
defaultAdaptiveThinking: z.enum(['true', 'false']).optional(),
personality: z.enum(['none', 'friendly', 'pragmatic']).optional(),
reasoningSummary: z.enum(['auto', 'concise', 'detailed', 'none']).optional(),
verbosity: z.enum(['low', 'medium', 'high']).optional(),
```

In `routes/settings.ts`, add the new keys to the destructure/persist loop alongside `defaultModel`/`defaultMode` (mirror the existing `set`/`delete` pattern).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/server/routes/chats.ts packages/core/src/server/routes/settings.ts \
        packages/core/src/server/routes/schemas.ts packages/core/src/__tests__/routes/chats.test.ts
git commit -m "feat(core): /tuning route + shared applyChatTuning, widen /effort, provider Zod"
```

---

## Phase F — Claude apply layer

### Task F1: `tuningToFlagSettings` helper

**Files:**
- Create: `packages/core/src/plugins/builtin/claude/tuning.ts`
- Test: `packages/core/src/plugins/builtin/claude/__tests__/tuning.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { tuningToFlagSettings } from '../tuning.js';

describe('tuningToFlagSettings', () => {
  it('maps effort + descriptor features to flag settings keys', () => {
    expect(tuningToFlagSettings({ effort: 'xhigh', fast: true, ultracode: false, adaptiveThinking: true }))
      .toEqual({ effortLevel: 'xhigh', fastMode: true, ultracode: false, alwaysThinkingEnabled: true });
  });
  it('omits absent (undefined) keys but keeps null (clears)', () => {
    expect(tuningToFlagSettings({ effort: null })).toEqual({ effortLevel: null });
    expect(tuningToFlagSettings({ fast: true })).toEqual({ fastMode: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm --filter @qlan-ro/mainframe-core test claude/__tests__/tuning` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { SessionTuning } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';

export function tuningToFlagSettings(t: SessionTuning): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  if (t.effort !== undefined) s.effortLevel = t.effort;
  for (const f of TUNABLE_FEATURES) {
    const v = t[f.key as keyof SessionTuning];
    if (v !== undefined) s[f.claudeSetting] = v;
  }
  return s;
}
```

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-core test claude/__tests__/tuning` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/tuning.ts packages/core/src/plugins/builtin/claude/__tests__/tuning.test.ts
git commit -m "feat(core): claude tuningToFlagSettings (descriptor-driven)"
```

### Task F2: Claude session — drop `--effort`, startup apply, `applyTuning`, setModel re-resolve

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/session.ts`
- Test: `packages/core/src/__tests__/session-spawn-args.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `session-spawn-args.test.ts`:

```ts
it('does NOT pass --effort (would install a masking permission layer)', () => {
  const args = buildSpawnArgs({ tuning: { effort: 'high' }, model: 'opus' });
  expect(args).not.toContain('--effort');
  expect(args).toContain('--model');
});
```

(If args are built inline in `spawn`, first extract a `buildSpawnArgs(options)` pure function and export it — that extraction keeps `session.ts` testable and is required here.)

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm --filter @qlan-ro/mainframe-core test session-spawn-args` → FAIL.

- [ ] **Step 3: Edit `spawn()`**

Remove the line `if (options.effort) args.push('--effort', options.effort);`. Keep `--model`. After the child is spawned and stdin is ready, write the startup apply (proactively, before any user message):

```ts
// after spawn, before returning processInfo:
if (options.tuning) {
  const settings = tuningToFlagSettings(options.tuning);
  if (Object.keys(settings).length > 0) {
    this.sendControlRequest(this.state.child!.stdin, { subtype: 'apply_flag_settings', settings });
  }
}
```

Replace the debug field `effort: options.effort ?? null` (around line 245) with `tuning: options.tuning ?? null`. Import `tuningToFlagSettings` from `./tuning.js`.

- [ ] **Step 4: Add `applyTuning` + `setModel` re-resolve**

Add the method (mirrors `setModel`):

```ts
async applyTuning(tuning: SessionTuning): Promise<void> {
  const child = this.state.child;
  if (!child) throw new Error(`Session ${this.id} not spawned`);
  const settings = tuningToFlagSettings(tuning);
  if (Object.keys(settings).length === 0) return;
  this.sendControlRequest(child.stdin, { subtype: 'apply_flag_settings', settings });
}
```

`setModel` re-resolve is handled at the lifecycle layer (Phase H), since the resolver needs the new model's caps — leave `setModel` as-is here.

- [ ] **Step 5: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-core test session-spawn-args` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/session.ts packages/core/src/__tests__/session-spawn-args.test.ts
git commit -m "feat(core): claude session applies tuning via apply_flag_settings (no --effort)"
```

---

## Phase G — Codex apply layer

### Task G1: `codex/turn-config.ts` (+ `CodexProviderTuning`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/turn-config.ts`
- Test: `packages/core/src/plugins/builtin/codex/__tests__/turn-config.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildTurnConfig } from '../turn-config.js';

describe('buildTurnConfig', () => {
  it('puts effort in collaborationMode.settings, fast as serviceTier, codex extras top-level', () => {
    const cfg = buildTurnConfig(
      { effort: 'high', fast: true, ultracode: false, adaptiveThinking: false },
      { personality: 'pragmatic', reasoningSummary: 'concise', verbosity: 'low' },
      { id: 'gpt-5.5', label: 'x', supportsFast: true, supportsPersonality: true },
      'default',
    );
    expect(cfg.collaborationMode.settings.reasoning_effort).toBe('high');
    expect(cfg.serviceTier).toBe('fast');
    expect(cfg.personality).toBe('pragmatic');
    expect(cfg.summary).toBe('concise');
    expect(cfg.verbosity).toBe('low');
  });

  it('omits serviceTier/personality when the model lacks the capability', () => {
    const cfg = buildTurnConfig(
      { effort: 'high', fast: true, ultracode: false, adaptiveThinking: false },
      { personality: 'pragmatic' }, { id: 'm', label: 'x' }, 'default',
    );
    expect(cfg.serviceTier).toBe('flex');
    expect(cfg.personality).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm --filter @qlan-ro/mainframe-core test codex/__tests__/turn-config` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { AdapterModel, ResolvedTuning } from '@qlan-ro/mainframe-types';
import type { CollaborationMode } from './types.js';

/** Codex-only provider config — stays in the codex package, never on shared spawn options. */
export interface CodexProviderTuning {
  personality?: 'none' | 'friendly' | 'pragmatic';
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
  verbosity?: 'low' | 'medium' | 'high';
}

export interface CodexTurnConfig {
  collaborationMode: CollaborationMode;
  serviceTier: 'fast' | 'flex';
  personality?: string;
  summary?: string;
  verbosity?: string;
}

export function buildTurnConfig(
  tuning: ResolvedTuning,
  codex: CodexProviderTuning,
  model: AdapterModel,
  mode: 'plan' | 'default',
): CodexTurnConfig {
  const cfg: CodexTurnConfig = {
    collaborationMode: {
      mode,
      settings: {
        model: model.id,
        reasoning_effort: tuning.effort, // null when model has no effort control
        developer_instructions: null,
      },
    },
    serviceTier: model.supportsFast && tuning.fast ? 'fast' : 'flex',
  };
  if (model.supportsPersonality && codex.personality) cfg.personality = codex.personality;
  if (codex.reasoningSummary) cfg.summary = codex.reasoningSummary;
  if (codex.verbosity) cfg.verbosity = codex.verbosity;
  return cfg;
}
```

> **Implementation note:** re-verify the exact `turn/start` field names (`serviceTier`, `summary`, `personality`, `verbosity`) and `Settings.reasoning_effort` against `codex app-server generate-ts --out /tmp/codex-schema` before wiring into `session.ts` — see the `codex-protocol-debugger` skill. Adjust field names here if the installed CLI differs.

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-core test codex/__tests__/turn-config` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/turn-config.ts packages/core/src/plugins/builtin/codex/__tests__/turn-config.test.ts
git commit -m "feat(core): codex buildTurnConfig + CodexProviderTuning boundary type"
```

### Task G2: Wire Codex session to use the turn config

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/session.ts`
- Modify: `packages/core/src/plugins/builtin/codex/types.ts` (extend `CollaborationModeSettings.reasoning_effort` already string|null — confirm)

- [ ] **Step 1: Store resolved tuning + codex defaults on the session**

Add fields `private pendingTuning: ResolvedTuning | null = null;` and `private codexDefaults: CodexProviderTuning = {};`. In `spawn(options)`, set `this.pendingTuning = options.tuning ? /* resolved upstream */ : null` — **note:** `options.tuning` is a `SessionTuning`; the Codex session resolves Codex defaults itself via `getProviderConfig(this.db, 'codex')` (the adapter/session already receives a db handle through its construction context; if not, pass it through `createSession`). Resolve once at spawn and on `applyTuning`.

- [ ] **Step 2: Replace `buildCollaborationMode()` usage in the `turn/start` call**

In the turn-start block (around line 229), replace the hand-built `collaborationMode` + `model` with `buildTurnConfig(...)` output and spread the top-level params:

```ts
const model = await this.resolveModelMeta(this.pendingModel); // existing model lookup or from adapter cache
const turnCfg = buildTurnConfig(this.pendingTuning ?? defaultResolved, this.codexDefaults, model, this.pendingPlanMode ? 'plan' : 'default');
await this.client.request<TurnStartResult>('turn/start', {
  threadId: this.state.threadId,
  input,
  approvalPolicy,
  sandboxPolicy: this.mapSandboxPolicy(sandbox),
  collaborationMode: turnCfg.collaborationMode,
  model: this.pendingModel,
  serviceTier: turnCfg.serviceTier,
  ...(turnCfg.personality ? { personality: turnCfg.personality } : {}),
  ...(turnCfg.summary ? { summary: turnCfg.summary } : {}),
  ...(turnCfg.verbosity ? { verbosity: turnCfg.verbosity } : {}),
});
```

Delete the old `buildCollaborationMode()` method (its `reasoning_effort: null` hardcode is gone).

- [ ] **Step 3: Add `applyTuning`**

```ts
async applyTuning(tuning: SessionTuning): Promise<void> {
  // Codex applies on the next turn/start; just update pending resolved tuning.
  this.pendingTuning = this.resolvePendingTuning(tuning);
}
```

- [ ] **Step 4: Typecheck core**

Run: `pnpm --filter @qlan-ro/mainframe-core typecheck`
Expected: PASS (resolve any remaining type gaps in codex session/types).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/session.ts packages/core/src/plugins/builtin/codex/types.ts
git commit -m "feat(core): codex session threads resolved tuning into turn/start"
```

---

## Phase H — Spawn seam + live-apply wiring

### Task H1: lifecycle-manager resolves tuning at spawn + live applyTuning

**Files:**
- Modify: `packages/core/src/chat/lifecycle-manager.ts`
- Modify: `packages/core/src/chat/chat-manager.ts` (expose `applyTuning` on the `ctx.chats` surface used by routes)
- Test: `packages/core/src/__tests__/lifecycle-tuning.test.ts` *(new, light integration)*

- [ ] **Step 1: Resolve tuning at the spawn seam**

At `lifecycle-manager.ts:471`, replace `effort: chat.effort` with a resolved tuning. Just before `session.spawn(...)`:

```ts
const providerCfg = getProviderConfig(this.deps.db, chat.adapterId);
const model = this.deps.adapterRegistry.getModel(chat.adapterId, chat.model); // existing model lookup; fall back to a minimal {id,label}
const tuning = resolveTuning(
  { effort: chat.effort, fast: chat.fast, ultracode: chat.ultracode, adaptiveThinking: chat.adaptiveThinking },
  providerCfg,
  model,
);
```

Then pass `tuning` (the resolved object, which is a valid `SessionTuning`) into the spawn options object instead of `effort: chat.effort`:

```ts
const processInfo = await session.spawn(
  { model: chat.model, permissionMode: chat.permissionMode, planMode: chat.planMode ?? false, executablePath, systemPrompt, tuning },
  sink,
);
```

(If `adapterRegistry.getModel` does not exist, add a small lookup that scans the adapter's cached `listModels()`/static catalog by id; a missing model yields `{ id, label: id }` so the resolver clamps to "no effort control".)

- [ ] **Step 2: Add live `applyTuning` to the chat-manager surface**

In `chat-manager.ts`, add a method the routes call:

```ts
async applyTuning(chatId: string, partial: SessionTuning): Promise<void> {
  const active = this.lifecycle.getActiveSession(chatId); // existing active-session lookup
  if (!active?.session?.applyTuning) return; // no live session → applied at next spawn
  try {
    await active.session.applyTuning(partial);
  } catch (err) {
    this.log.warn({ err, chatId }, 'live applyTuning failed');
  }
}
```

Ensure this manager is what `ctx.chats` points to in the route context (it already exposes `syncChatFields`).

- [ ] **Step 3: Write a light integration test**

Assert that spawning a chat with `effort: 'xhigh'` + an Opus-like model produces `SessionSpawnOptions.tuning.effort === 'xhigh'`, and with a no-effort model produces `tuning.effort === null`. Mock the adapter/session; capture the `spawn` argument.

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-core test lifecycle-tuning` → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @qlan-ro/mainframe-core typecheck
git add packages/core/src/chat/lifecycle-manager.ts packages/core/src/chat/chat-manager.ts packages/core/src/__tests__/lifecycle-tuning.test.ts
git commit -m "feat(core): resolve tuning at spawn + live applyTuning wiring"
```

---

## Phase I — UI shared module

### Task I1: `lib/model-tuning.ts`

**Files:**
- Create: `packages/desktop/src/renderer/lib/model-tuning.ts`
- Test: `packages/desktop/src/__tests__/lib/model-tuning.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { effortOptions, visibleFeatures, FEATURE_LABELS } from '../../renderer/lib/model-tuning';

describe('model-tuning helpers', () => {
  it('effortOptions maps supportedEfforts to labelled options', () => {
    const opts = effortOptions({ id: 'm', label: 'M', supportedEfforts: ['low', 'xhigh', 'max'] });
    expect(opts.map((o) => o.id)).toEqual(['low', 'xhigh', 'max']);
    expect(opts.find((o) => o.id === 'xhigh')!.label).toBe('Extra-high');
  });
  it('visibleFeatures gates by capability', () => {
    expect(visibleFeatures({ id: 'm', label: 'M', supportsFast: true }).map((f) => f.key)).toEqual(['fast']);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm --filter @qlan-ro/mainframe-desktop test model-tuning` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { AdapterModel, EffortLevel, FeatureKey } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';

export const EFFORT_META: Record<EffortLevel, { label: string; description: string }> = {
  none: { label: 'None', description: 'No reasoning' },
  minimal: { label: 'Minimal', description: 'Fastest, least reasoning' },
  low: { label: 'Low', description: 'Quick, straightforward' },
  medium: { label: 'Medium', description: 'Balanced speed and depth' },
  high: { label: 'High', description: 'Thorough reasoning' },
  xhigh: { label: 'Extra-high', description: 'Extra reasoning for hard tasks' },
  max: { label: 'Maximum', description: 'Maximum reasoning depth' },
};

export const FEATURE_LABELS: Record<FeatureKey, { label: string; desc: string }> = {
  fast: { label: 'Fast mode', desc: 'Faster output; may draw on usage credits' },
  ultracode: { label: 'Ultracode', desc: 'xhigh effort + dynamic workflows' },
  adaptiveThinking: { label: 'Adaptive thinking', desc: 'Claude decides when/how much to think' },
};

export function effortOptions(model: AdapterModel) {
  return (model.supportedEfforts ?? []).map((id) => ({ id, ...EFFORT_META[id] }));
}

export function visibleFeatures(model: AdapterModel) {
  return TUNABLE_FEATURES.filter((f) => model[f.capability]).map((f) => ({ key: f.key as FeatureKey, ...FEATURE_LABELS[f.key as FeatureKey] }));
}
```

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-desktop test model-tuning` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/model-tuning.ts packages/desktop/src/__tests__/lib/model-tuning.test.ts
git commit -m "feat(desktop): shared model-tuning module (effort meta + feature labels)"
```

---

## Phase J — UI composer

### Task J1: API client `setChatTuning`

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/index.ts` (+ the chats-api module that defines `setChatEffort`)

- [ ] **Step 1: Add the client function** (mirror `setChatEffort`'s PATCH shape)

```ts
export async function setChatTuning(chatId: string, tuning: SessionTuning): Promise<void> {
  await apiFetch(`/api/chats/${chatId}/tuning`, { method: 'PATCH', body: JSON.stringify(tuning) });
}
```

Export it from `lib/api/index.ts`. (Keep `setChatEffort` for any existing callers; new code uses `setChatTuning`.)

- [ ] **Step 2: Typecheck** — Run: `pnpm --filter @qlan-ro/mainframe-desktop typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/api
git commit -m "feat(desktop): setChatTuning api client"
```

### Task J2: EffortPicker dynamic options

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/EffortPicker.tsx`
- Test: `packages/desktop/src/__tests__/components/composer/EffortPicker.test.tsx`

- [ ] **Step 1: Update the test**

Replace the static-options assertions with capability-driven ones:

```ts
it('renders only the model’s supported efforts incl. xhigh/max', () => {
  renderPicker({ adapters: adaptersWith({ id: 'opus', supportedEfforts: ['low','medium','high','xhigh','max'] }) , modelId: 'opus' });
  expect(screen.getByTestId('composer-effort-select')).toBeInTheDocument();
  // open + assert xhigh/max present (use the dropdown’s existing open interaction)
});
it('is hidden for a model with no efforts', () => {
  renderPicker({ adapters: adaptersWith({ id: 'haiku' }), modelId: 'haiku' });
  expect(screen.queryByTestId('composer-effort-select')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm --filter @qlan-ro/mainframe-desktop test EffortPicker` → FAIL.

- [ ] **Step 3: Rewrite EffortPicker to use the shared helpers**

```tsx
import { effortOptions } from '../../../../lib/model-tuning';
import { setChatTuning } from '../../../../lib/api';

export function shouldShowEffortPicker(adapterId: string, modelId: string, adapters: AdapterInfo[]): boolean {
  const model = adapters.find((a) => a.id === adapterId)?.models.find((m) => m.id === modelId);
  return (model?.supportedEfforts?.length ?? 0) > 0;
}

export function EffortPicker({ chat, adapters, modelId, disabled = false }: EffortPickerProps) {
  if (!shouldShowEffortPicker(chat.adapterId, modelId, adapters)) return null;
  const model = adapters.find((a) => a.id === chat.adapterId)?.models.find((m) => m.id === modelId)!;
  const options = effortOptions(model);
  const current = chat.effort ?? model.defaultEffort ?? 'medium';
  const updateChat = useChatsStore((s) => s.updateChat);
  const handleChange = useCallback((id: string) => {
    const next = id as ChatEffort;
    updateChat({ ...chat, effort: next });
    setChatTuning(chat.id, { effort: next }).catch((err) => log.warn('setChatTuning failed', { err: String(err) }));
  }, [chat, updateChat]);
  return (
    <ComposerDropdown data-testid="composer-effort-select" items={options} value={current}
      onChange={handleChange} disabled={disabled} icon={<Gauge size={14} />} />
  );
}
```

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-desktop test EffortPicker` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/composer/EffortPicker.tsx \
        packages/desktop/src/__tests__/components/composer/EffortPicker.test.tsx
git commit -m "feat(desktop): dynamic effort options from model.supportedEfforts"
```

### Task J3: FeaturesPopover

**Files:**
- Create: `.../composer/FeaturesPopover.tsx`
- Modify: `.../composer/ComposerCard.tsx`
- Test: `packages/desktop/src/__tests__/components/composer/FeaturesPopover.test.tsx` *(new)*

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FeaturesPopover } from '../../../../renderer/components/chat/assistant-ui/composer/FeaturesPopover';

it('shows only supported features; Codex → fast only', () => {
  render(<FeaturesPopover chat={chatFor('codex')} adapters={adaptersWith({ id: 'gpt', supportsFast: true })} modelId="gpt" />);
  fireEvent.click(screen.getByTestId('composer-features-trigger'));
  expect(screen.getByTestId('composer-feature-fast')).toBeInTheDocument();
  expect(screen.queryByTestId('composer-feature-ultracode')).toBeNull();
});

it('hides the trigger when no features are supported', () => {
  render(<FeaturesPopover chat={chatFor('claude')} adapters={adaptersWith({ id: 'haiku' })} modelId="haiku" />);
  expect(screen.queryByTestId('composer-features-trigger')).toBeNull();
});

it('toggling ultracode persists and is reflected', () => {
  const spy = vi.spyOn(api, 'setChatTuning').mockResolvedValue();
  render(<FeaturesPopover chat={chatFor('claude')} adapters={adaptersWith({ id: 'opus', supportsFast: true, supportsUltracode: true, supportsAdaptiveThinking: true, supportedEfforts: ['low','xhigh'] })} modelId="opus" />);
  fireEvent.click(screen.getByTestId('composer-features-trigger'));
  fireEvent.click(screen.getByTestId('composer-feature-ultracode'));
  expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ ultracode: true, effort: 'xhigh' }));
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm --filter @qlan-ro/mainframe-desktop test FeaturesPopover` → FAIL.

- [ ] **Step 3: Implement `FeaturesPopover.tsx`**

```tsx
import { useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { AdapterInfo, Chat, SessionTuning } from '@qlan-ro/mainframe-types';
import { Toggle } from '../../../ui/toggle';
import { ComposerDropdown } from './ComposerDropdown'; // reuse its popover shell, or a small Popover primitive
import { visibleFeatures } from '../../../../lib/model-tuning';
import { setChatTuning } from '../../../../lib/api';
import { useChatsStore } from '../../../../store/chats';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:features-popover');

export function FeaturesPopover({ chat, adapters, modelId, disabled = false }: {
  chat: Chat; adapters: AdapterInfo[]; modelId: string; disabled?: boolean;
}) {
  const model = adapters.find((a) => a.id === chat.adapterId)?.models.find((m) => m.id === modelId);
  const features = model ? visibleFeatures(model) : [];
  const updateChat = useChatsStore((s) => s.updateChat);

  const setFeature = useCallback((key: keyof SessionTuning, value: boolean) => {
    const patch: SessionTuning = { [key]: value };
    if (key === 'ultracode' && value) patch.effort = 'xhigh'; // coupling mirrors the CLI
    updateChat({ ...chat, ...patch });
    setChatTuning(chat.id, patch).catch((err) => log.warn('setChatTuning failed', { err: String(err) }));
  }, [chat, updateChat]);

  if (features.length === 0) return null;

  return (
    <ComposerDropdown
      data-testid="composer-features-trigger"
      icon={<SlidersHorizontal size={14} />}
      disabled={disabled}
      renderMenu={() => (
        <div className="flex flex-col gap-1 p-2 min-w-56">
          {features.map((f) => {
            const checked = Boolean(chat[f.key] ?? false);
            return (
              <label key={f.key} className="flex items-start justify-between gap-3 px-2 py-1.5 rounded-mf-input hover:bg-mf-hover">
                <span className="flex-1">
                  <span className="text-mf-small text-mf-text-primary">{f.label}</span>
                  <span className="block text-mf-status text-mf-text-secondary">{f.desc}</span>
                </span>
                <Toggle data-testid={`composer-feature-${f.key}`} checked={checked} disabled={disabled}
                  onChange={(v) => setFeature(f.key as keyof SessionTuning, v)} />
              </label>
            );
          })}
        </div>
      )}
    />
  );
}
```

> If `ComposerDropdown` cannot render an arbitrary menu body, add a minimal `renderMenu` prop to it (passthrough) or use the existing popover primitive used by `WorktreePopover.tsx`. Do not hardcode ids in the shared primitive — forward `data-testid` via `{...props}`.

- [ ] **Step 4: Mount it in `ComposerCard.tsx`**

Next to `<EffortPicker .../>` (line ~436):

```tsx
{chat && <FeaturesPopover chat={chat} adapters={adapters} modelId={currentModel} disabled={!!chat.isRunning} />}
```

Add the import.

- [ ] **Step 5: Run to verify pass** — Run: `pnpm --filter @qlan-ro/mainframe-desktop test FeaturesPopover` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/composer/FeaturesPopover.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerDropdown.tsx \
        packages/desktop/src/__tests__/components/composer/FeaturesPopover.test.tsx
git commit -m "feat(desktop): capability-gated FeaturesPopover with Toggle switches"
```

---

## Phase K — UI settings (decomposed)

### Task K1: `ProviderTuningDefaults` + `CodexTuningDefaults`

**Files:**
- Create: `.../settings/ProviderTuningDefaults.tsx`
- Create: `.../settings/CodexTuningDefaults.tsx`
- Modify: `.../settings/ProviderSection.tsx`
- Test: `packages/desktop/src/__tests__/components/settings/ProviderTuningDefaults.test.tsx` *(new)*

- [ ] **Step 1: Write the failing test**

```tsx
it('renders default-effort + supported feature toggles, capability-gated', () => {
  render(<ProviderTuningDefaults adapterId="claude" model={{ id: 'opus', label: 'Opus', supportedEfforts: ['low','high','xhigh'], supportsFast: true, supportsUltracode: true, supportsAdaptiveThinking: true }} config={{}} onChange={vi.fn()} />);
  expect(screen.getByTestId('providers-claude-default-effort')).toBeInTheDocument();
  expect(screen.getByTestId('providers-claude-default-feature-fast')).toBeInTheDocument();
});
it('CodexTuningDefaults shows personality/summary/verbosity', () => {
  render(<CodexTuningDefaults adapterId="codex" model={{ id: 'gpt', label: 'GPT', supportsPersonality: true }} config={{}} onChange={vi.fn()} />);
  expect(screen.getByTestId('providers-codex-personality')).toBeInTheDocument();
  expect(screen.getByTestId('providers-codex-reasoning-summary')).toBeInTheDocument();
  expect(screen.getByTestId('providers-codex-verbosity')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm --filter @qlan-ro/mainframe-desktop test ProviderTuningDefaults` → FAIL.

- [ ] **Step 3: Implement `ProviderTuningDefaults.tsx`**

```tsx
import type { AdapterModel, ProviderConfig } from '@qlan-ro/mainframe-types';
import { Toggle } from '../ui/toggle';
import { effortOptions, visibleFeatures } from '../../lib/model-tuning';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';

export function ProviderTuningDefaults({ adapterId, model, config, onChange }: {
  adapterId: string; model: AdapterModel; config: ProviderConfig; onChange: (p: Partial<ProviderConfig>) => void;
}) {
  const efforts = effortOptions(model);
  const features = visibleFeatures(model);
  const providerKey = (k: string) => TUNABLE_FEATURES.find((f) => f.key === k)!.providerDefault as keyof ProviderConfig;
  return (
    <div className="space-y-3">
      {efforts.length > 0 && (
        <label className="block space-y-1.5">
          <span className="text-mf-small text-mf-text-secondary">Default Effort</span>
          <select data-testid={`providers-${adapterId}-default-effort`}
            value={config.defaultEffort ?? model.defaultEffort ?? ''}
            onChange={(e) => onChange({ defaultEffort: (e.target.value || undefined) as ProviderConfig['defaultEffort'] })}
            className="w-full px-3 py-1.5 text-mf-small bg-mf-input-bg text-mf-text-primary border border-mf-border rounded-mf-input focus:outline-none focus:border-mf-accent">
            {efforts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      )}
      {features.map((f) => {
        const key = providerKey(f.key);
        return (
          <label key={f.key} className="flex items-center justify-between gap-3">
            <span className="text-mf-small text-mf-text-primary">{f.label}</span>
            <Toggle data-testid={`providers-${adapterId}-default-feature-${f.key}`}
              checked={config[key] === 'true'}
              onChange={(v) => onChange({ [key]: v ? 'true' : 'false' } as Partial<ProviderConfig>)} />
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Implement `CodexTuningDefaults.tsx`**

```tsx
import type { AdapterModel, ProviderConfig } from '@qlan-ro/mainframe-types';

const SUMMARY = ['auto', 'concise', 'detailed', 'none'] as const;
const VERBOSITY = ['low', 'medium', 'high'] as const;
const PERSONALITY = ['none', 'friendly', 'pragmatic'] as const;

export function CodexTuningDefaults({ adapterId, model, config, onChange }: {
  adapterId: string; model: AdapterModel; config: ProviderConfig; onChange: (p: Partial<ProviderConfig>) => void;
}) {
  const Select = (testid: string, value: string | undefined, opts: readonly string[], key: keyof ProviderConfig) => (
    <select data-testid={testid} value={value ?? ''}
      className="w-full px-3 py-1.5 text-mf-small bg-mf-input-bg text-mf-text-primary border border-mf-border rounded-mf-input focus:outline-none focus:border-mf-accent"
      onChange={(e) => onChange({ [key]: (e.target.value || undefined) } as Partial<ProviderConfig>)}>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  return (
    <div className="space-y-3">
      {model.supportsPersonality && (
        <label className="block space-y-1.5"><span className="text-mf-small text-mf-text-secondary">Personality</span>
          {Select(`providers-${adapterId}-personality`, config.personality, PERSONALITY, 'personality')}</label>
      )}
      <label className="block space-y-1.5"><span className="text-mf-small text-mf-text-secondary">Reasoning Summary</span>
        {Select(`providers-${adapterId}-reasoning-summary`, config.reasoningSummary, SUMMARY, 'reasoningSummary')}</label>
      <label className="block space-y-1.5"><span className="text-mf-small text-mf-text-secondary">Verbosity</span>
        {Select(`providers-${adapterId}-verbosity`, config.verbosity, VERBOSITY, 'verbosity')}</label>
    </div>
  );
}
```

- [ ] **Step 5: Compose them in `ProviderSection.tsx`**

After the existing `<ModelDropdown .../>`, resolve the default model and mount both (keeps `ProviderSection` under 300 lines):

```tsx
const defaultModel = models.find((m) => m.id === (config.defaultModel ?? 'default')) ?? models[0];
{defaultModel && <ProviderTuningDefaults adapterId={adapterId} model={defaultModel} config={config} onChange={update} />}
{adapterId === 'codex' && defaultModel && <CodexTuningDefaults adapterId={adapterId} model={defaultModel} config={config} onChange={update} />}
```

- [ ] **Step 6: Run to verify pass + check size**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test ProviderTuningDefaults` → PASS.
Run: `wc -l packages/desktop/src/renderer/components/settings/ProviderSection.tsx` → expect < 300.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/components/settings/ProviderTuningDefaults.tsx \
        packages/desktop/src/renderer/components/settings/CodexTuningDefaults.tsx \
        packages/desktop/src/renderer/components/settings/ProviderSection.tsx \
        packages/desktop/src/__tests__/components/settings/ProviderTuningDefaults.test.tsx
git commit -m "feat(desktop): provider tuning defaults (decomposed) + codex tuning block"
```

---

## Phase L — E2E

### Task L1: Mock capability fixtures + composer + settings + inheritance specs

**Files:**
- Modify: the mock CLI plugin fixtures (the `initialize` / `model/list` responses the e2e mock returns)
- Modify: `packages/e2e/tests/44-composer-config.spec.ts`, `packages/e2e/scenarios/composer.md`
- Modify: `packages/e2e/tests/41-settings.spec.ts`
- Create: `packages/e2e/tests/56-model-tuning-inheritance.spec.ts` *(new, next free number)*

- [ ] **Step 1: Add capabilities to the mock fixtures**

In the mock CLI plugin's model payloads, advertise: a Claude mock model with `supportedEffortLevels: ['low','medium','high','xhigh','max']`, `supportsFastMode: true`, `supportsAdaptiveThinking: true`; a Codex mock model with `supportedReasoningEfforts` (low→xhigh), `additionalSpeedTiers: ['fast']`, `supportsPersonality: true`. (Locate the fixture via the mock-plugin record/replay files referenced in `packages/e2e/FLOW-MAP.md`.)

- [ ] **Step 2: Extend `44-composer-config.spec.ts`**

Add assertions: effort select lists `xhigh`/`max` for the capable model and not for a Sonnet-class mock; `composer-features-trigger` opens the popover; `composer-feature-ultracode` toggles, persists across reselect, and the effort chip shows `xhigh`; controls disabled while running. Update scenario `composer.md` M5 text to match (replace the `supportsEffort`/Low-Medium-High wording).

- [ ] **Step 3: Extend `41-settings.spec.ts`**

Open Provider settings → assert `providers-<id>-default-effort` and `providers-<id>-default-feature-fast`; for Codex assert the personality/summary/verbosity selects; change one, reopen the modal, assert persistence.

- [ ] **Step 4: New inheritance spec (`56-...`)**

Set a provider default (e.g. default effort = `high`, Fast on) → create a new chat → assert the composer reflects the inherited values → set a per-chat override → assert it did not change the provider default (reopen settings).

- [ ] **Step 5: Run the e2e subset**

Run: `pnpm --filter @qlan-ro/mainframe-e2e test 44-composer-config 41-settings 56-model-tuning-inheritance` (use the package's actual e2e runner invocation from its `package.json`).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/e2e
git commit -m "test(e2e): model-tuning capabilities, composer popover, settings, inheritance"
```

---

## Phase M — Full verification + changeset

### Task M1: Cross-package typecheck, tests, changeset

- [ ] **Step 1: Typecheck every package**

Run: `pnpm -r typecheck`
Expected: PASS. Fix any straggler `ChatEffort`/`supportsEffort` references the compiler surfaces (e.g. desktop stores, mobile is excluded).

- [ ] **Step 2: Run the affected test suites**

Run: `pnpm --filter @qlan-ro/mainframe-core test` and `pnpm --filter @qlan-ro/mainframe-desktop test`
Expected: PASS, coverage thresholds met.

- [ ] **Step 3: Add the changeset**

Run: `pnpm changeset` → select `@qlan-ro/mainframe-types`, `@qlan-ro/mainframe-core`, `@qlan-ro/mainframe-desktop` → **minor**. Summary: "Dynamic per-model effort levels + fast/ultracode/adaptive-thinking flags (composer) and Codex personality/summary/verbosity (settings), driven by adapter capabilities."

- [ ] **Step 4: Commit**

```bash
git add .changeset
git commit -m "chore: changeset for model/harness config flags"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/model-config-flags
gh pr create --title "feat: dynamic model & harness config flags (Claude + Codex)" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-06-04-model-config-flags-design.md.

Per-model effort levels (incl. xhigh/max) + fast/ultracode/adaptive-thinking in the
composer; Codex personality/summary/verbosity in provider settings. Capability-driven
(no hardcoded lists); Claude applies via apply_flag_settings (no --effort, which would
install a masking permission layer); Codex via turn/start. Codex-approved + structurally
reviewed.

Mobile UI for the new flags is intentionally out of scope (separate mainframe-mobile PR);
the legacy /effort route stays for back-compat.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **Codex field names:** before Phase G wiring, run `codex app-server generate-ts --out /tmp/codex-schema` and confirm `TurnStartParams` field names (`serviceTier`/`summary`/`personality`/`verbosity`) and `Settings.reasoning_effort`. Adjust `turn-config.ts` if the installed CLI differs. Documented in `.claude/skills/codex-protocol-debugger/SKILL.md`.
- **Do not pass `--effort`** to the Claude CLI — verified in the binary to install a `{kind:"effort"}` permission layer that masks `apply_flag_settings`. The regression test in Task F2 guards this.
- **300-line ceiling:** `claude/session.ts` (554) and `codex/session.ts` (435) are already over — keep new logic in the `tuning.ts`/`turn-config.ts` helpers; do not append.
- **Mobile submodule:** never modify `packages/mobile`; the `/effort` route keeps it working until its own PR.
