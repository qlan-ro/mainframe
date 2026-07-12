# Automations v2 — UI Implementation Plan (packages/ui)

**Date:** 2026-07-12 · **Scope:** `packages/ui` only (consumed by the app-tauri shell)
**Authoritative inputs, in precedence order:**
1. `docs/plans/2026-07-12-automations-v2-contract.md` — ratified cross-plan contract;
   wins over everything below for wire shapes, ids, and names.
2. `docs/designs/2026-07-11-automations-v2-spec.md` — product spec (model, screens §13).
3. `docs/designs/wf2-prototype/` — visual/interaction spec, cache `ts153`; all five
   review-pass fixes verified landed (see its README).
**Replaces:** the entire v1 workflows UI (authoring, YAML editor, step library, run views).
**Sequencing (contract §7):** UI P6 needs Node routes live; UI P7 deletes the v1 UI
tree and MUST precede Node Task 29 (removes `packages/types/src/workflow.ts` +
`workflow.*` events — the v1 UI imports those). The app never ships without a screen.

## Contract summary (build against, never rename)

- Types from `@qlan-ro/mainframe-types` (Node plan owns creating them): step kinds
  `ask_agent | ask_me | run_action | notify | if | repeat`;
  `TokenRef = {stepId, output, field?}` — flat, reserved stepIds `trigger`, `builtin`
  (outputs `today`/`now`), `current`; `field` is a dot-path;
  `ChipPart = string | {token: TokenRef}` (flat union, NOT tagged), `ChipText =
  ChipPart[]`. Step base: `id` (opaque non-empty string, never shown), `keepGoing?`.
  Ask-me field visibility is `showWhen: {key, equals}`; Repeat's list field is `items`.
  Run-action params are `Record<string, ChipText>` (no raw-JSON variant).
  Steps have NAMED outputs, camelCase on the wire (§5 table) — `run_command` →
  `output`/`exitCode`, `ask_agent` → `result`/`chatId` (+ A2 `expects` keys),
  `github.create_pr` → `prUrl`/`prNumber`, `github.list_prs` → `prs` (items
  `{url,title,number,author}`), `notion.add_row` → `pageUrl`, `ado.create_item` →
  `workItemId`/`url`, `files.read` → `content` (no `path`), `http.request` →
  `status`/`body`, `mcp:*` → `result`. Output-type enum = `text|number|list|record`.
  `domain/tokens.ts` stepProduces + fixtures emit exactly these; the picker binds
  `{stepId, output}` and shows friendly labels only.
- Comparators (A3): `is | is_not | contains | starts_with | eq | lt | gt | is_empty |
  not_empty | is_one_of`. `contains` is polymorphic (substring/membership);
  `is_one_of` takes an array value → the condition row needs a multi-select value
  editor (choice tokens: multi-select of their own options; text: value-chip list).
- Triggers: schedule `{schedule, onMissed: 'run_once'|'skip'}` (picker offers only
  divisors of 24 for every-N-hours); curated events `session.finished |
  automation.finished | automation.failed` ONLY — GitHub *PR opened/merged* show in the
  list but are **webhook presets** (`POST /api/automation-webhooks/:hookId`, daemon-side
  match predicate); manual always available.
- Run statuses `running|waiting|succeeded|failed|cancelled`; interactions
  `pending|answered|cancelled`.
- REST (contract §4, WS4 envelope): `GET/POST /api/automations`, `GET/PUT/DELETE
  /api/automations/:id`, runs (`:id/runs`, `automation-runs/:id`, `.../cancel`),
  interactions (`automation-interactions`, `:id/respond`), `automation-actions`
  (catalog + field metadata → auto-forms), `automation-credentials[/:label]`. Webhook
  ingress `POST /api/automation-webhooks/:hookId` is daemon-only, not a UI caller.
- Action ids (contract §5): `run_command`, `files.append|files.write|files.read` (three
  entries — the prototype's single op-segment "Files" is superseded), `http.request`,
  `github.create_pr|list_prs`, `notion.add_row`, `ado.create_item`, `mcp:<server>:<tool>`.
- WS events (exactly 5): `automation.run.updated {run}`, `automation.interaction.created
  {interaction}`, `automation.interaction.resolved {interactionId, runId}`,
  `automation.completed {automationId, automationName, runId, status:'succeeded'|'failed',
  result}`, `automation.notification {runId, automationId, title, body, links:{runId,
  chatIds}}` — additive `DaemonEvent` members. NOTE: `automation.failed` is a trigger
  *selector*, NOT a WS event — a failed run arrives as `automation.completed{status:
  'failed'}`; the events handler switches on those five names only.
- Amendments the UI must carry: **A1** — `run_command` set-up panel gets a read-only
  "what will run" preview: chips become quoted `"$MF_<n>"` where they sat, only
  author-typed literals are shell source. The preview MUST detect a chip inside single
  quotes or a quoted heredoc (where `$MF_<n>` won't expand) and show a plain-language
  warning instead of a misleading resolved preview. Run-in is an enum
  (`project root|worktree|custom`); `cwd` is validated (containment), NOT env-substituted
  — out of the preview. **A2** — `ask_agent` gains an "Expect results" builder (rows: key
  + type `text|number|list|choice` + options); declared keys become typed tokens
  alongside ⟨Agent result⟩. No ts153 artboard — styled from the form-builder idiom.

## Binding conventions

- ≤300 lines/file, ≤50/function; the prototype's 5 modules decompose into the tree below.
- `data-testid` on every interactive element: `automations-<element>[-<domainId>]`
  kebab-case, keyed by automation/step/run id (ids in testids only, never in copy).
- `React.lazy` + `Suspense` for the editor and run view — first lazy usage in this package.
- Tailwind v4 with `--mf-*` tokens from `packages/ui/src/styles/globals.css` (the real
  token file — `mainframe-theme.css` is a stale name); opacity modifiers fine. NEVER
  legacy desktop `mf-*` utility classes (phantom/unstyled here).
- Shared `Hint` (`components/ui/hint.tsx`) WRAPS Popover/Dropdown triggers, never sits
  inside them. Toasts only via `mfToast` from `@/lib/toast`, never sonner directly.
- REST via `lib/api/http.ts` (`request<T>`; envelope field is `success`, not `ok`); WS
  via the `daemonWs.onEvent` singleton (`lib/daemon/ws-client.ts`). Zustand stores
  (`^5.0.14` already in `package.json`). No zod in the UI (daemon owns enforcement).
- User-facing label stays **"Workflows"** (prototype copy); code/routes/testids say
  `automations`.

## Decision: where pure logic lives

Token scoping, comparators, chip-part helpers, command preview (A1), and plain-language
validation go in `features/automations/domain/` — pure functions, zero React, zero I/O.
The "pure logic lives in core" rule can't mean importing `@qlan-ro/mainframe-core` from
the renderer (Node-only: better-sqlite3, pino); the correct shared home is
`packages/types` next to `AutomationDefinition` — browser-safe, already a dep of both ui
and core, so the daemon's canonical validation imports the same functions. UI starts
with the local `domain/` module, moves it to `packages/types` as a Phase 6 task.

## UI-critical semantics to preserve (verified in ts153)

- **Token scope** = trigger tokens + built-ins + every token produced by earlier
  siblings at this level or an ancestor; If-branch outputs leak to later siblings
  (`wf2StepProduces` recurses then/else); Repeat is isolated — ⟨Current item⟩
  (`{stepId:'current'}`, + fields of the chosen list token) lives only inside the
  bracket. Out-of-scope tokens don't appear in the picker.
- **Typed comparators**: choice tokens get option dropdowns (`is`/`is_not`) + option
  multi-select (`is_one_of`); no-value comparators (`is_empty`/`not_empty`) hide the value.
- **Chip-part arrays are the editing model** — structural edits only (insert/remove
  chip, merge draft tail, backspace pops last part). No string parsing, ever.
- **User never sees step ids.** Chips store `{token: TokenRef}`; display resolves at
  render from definition + catalog. Renaming re-labels chips; a deleted producer becomes
  a pinned validation issue on the consumer, not a crash.
- Validation issues carry `stepId` → red strip on the offending card (footer summary
  secondary). `keepGoing` toggle on all four verbs; run view shows "Kept going".
  Ask-agent More options: attachments, worktree (base+branch), auto-approve chips,
  budget cap, permission mode, Expect results (A2).

## Component / file tree (new files under `packages/ui/src/features/automations/`)

```
AutomationsHost.tsx         AppShell-mounted host (WorkflowsModalHost slot); lazy editor/run + Suspense
AutomationsView.tsx         shell: header + view switch (library|editor|run|describe)
contract.ts                 TEMP mirror of the Automation* contract types (→ re-export in Phase 6)
flags.ts                    DESCRIBE_ENABLED (default false)
domain/tokens.ts            stepProduces (named outputs), scopeAt (If leak, Repeat isolation, reserved ids)
domain/comparators.ts       comparatorsFor(type), comparatorNeedsValue, isMultiValue
domain/validate.ts          plain-language issues [{stepId, level, msg}]
domain/chip-parts.ts        isTokenPart, mergeDraftTail, partsToPlainText
domain/resolve.ts           resolveTokenRef(def, catalog, ref) → display descriptor (+ "missing producer")
domain/command-preview.ts   A1: chip script → {envMap, "$MF_<n>" text, warnings[] for chips in single quotes/heredocs}
domain/trigger-summary.ts   trigger → human summary descriptor
fixtures/fixtures.ts        LOADS the six Node-owned packages/types/fixtures/automations/*.json
                            (mirror 1:1 until they land, never diverge); fixture 6
                            daily-feature-spike.json = sole A1+A2+A3 carrier
fixtures/fixture-gateway.ts in-memory gateway + scripted event emitter
data/gateway.ts             AutomationsGateway interface (all REST verbs)
data/http-gateway.ts        real impl over lib/api/automations.ts
data/use-automations-store.ts  zustand: definitions/runs/interactions/catalog/credentials via gateway
data/use-automations-nav.ts    zustand: open/close, view stack, editor target, run id
data/use-automation-events.ts  daemonWs.onEvent → store patches (5 event types)
data/use-automation-toasts.ts  notification/completed/failed → mfToast + View-run/Open-chat actions
library/LibraryList.tsx     header + New + rows; BlankState when empty
library/LibraryRow.tsx      name, scope badge, trigger chips, last-run pill, Run now, Edit, toggle
library/LastRunPill.tsx     status dot/spinner + relative time
library/BlankState.tsx      "Describe it" / "Build it" cards (spec §10)
describe/DescribeFlow.tsx   textarea + Draft it + hint state (stub behind flag)
describe/DraftPreview.tsx   read-only When/Do block list + Open in editor
editor/AutomationEditor.tsx shell: name, WhenCard, Recipe, footer summary, Save; useMemo(validate)
editor/WhenCard.tsx         trigger rows + add menu (schedule / events + PR webhook presets / manual)
editor/TriggerRow.tsx       per-kind row; webhook: generated URL, signature note, sample placeholder
editor/SchedulePicker.tsx   curated schedules + onMissed run_once/skip toggle
editor/Recipe.tsx           recursive list; running-scope accumulation; drag reorder
editor/StepCard.tsx         leaf card: grip, icon, title, summary, issue strip, "Set up" disclosure
editor/BlockCard.tsx        If/Repeat bracket frame (tinted border + left rule)
editor/IfBody.tsx           condition rows, and/or, Match all/any, Then/Otherwise, add-otherwise
editor/RepeatBody.tsx       "For each item in" list-token pick + inner recipe
editor/ConditionRow.tsx     token chip · comparator · value (text / choice dropdown / is_one_of multi)
editor/AddStepMenu.tsx      verbs pinned on top, searchable action catalog below
editor/StepSummary.tsx      per-verb collapsed summary line (ChipText etc.)
steps/AgentConfig.tsx       prompt ChipField (slash), model; More: attachments, worktree, auto-approve, budget, permission, ExpectResults, FailureToggle
steps/ExpectResultsBuilder.tsx  A2 rows: key + type + options-for-choice
steps/AttachmentsField.tsx  add/remove image-file chips
steps/AskMeConfig.tsx       title + field list + add-field
steps/FormFieldRow.tsx      label/type/required, options chip editor, "show only when…"
steps/ActionConfig.tsx      picked-action header + Change; embeds catalog when unpicked
steps/CommandPreview.tsx    A1 read-only "what will run" block + won't-expand warning
steps/ActionCatalog.tsx     search, All/Built-in/Connectors/MCP segments, LIST/ADVANCED badges
steps/AutoForm.tsx          catalog metadata → controls: select/segment/text/credential/columns-map/code/chiparea/chip
steps/CredentialConnect.tsx "Connect <service>…" ↔ connected pill; credentials routes
steps/NotifyConfig.tsx      message ChipField + auto-links note
steps/FailureToggle.tsx     "Keep going if this step fails" (writes step.keepGoing)
steps/MoreOptions.tsx       disclosure wrapper
fields/ChipField.tsx        chip-part editor: draft tail, backspace-pop, ⟨⟩ button, slash trigger
fields/TokenChip.tsx        chip render (color/icon/label, › field sub, remove)
fields/TokenPicker.tsx      grouped-by-source popover; object tokens expand to fields
fields/SlashMenu.tsx        slash-command suggestions
fields/MiniSelect.tsx       compact select (wraps ui/select styling)
run/RunView.tsx             header (name, trigger·time, status pill, Run again, Cancel) + timeline
run/RunStepRow.tsx          spine node, status, duration, output/error/chat disclosures, Kept-going
run/RunRepeatGroup.tsx      nested fan-out children (stepRef `<id>#<iteration>`)
run/RunInlineForm.tsx       paused Ask-me form: choice/multi pills, inputs, show-when, Submit → respond
lib/api/automations.ts      (in lib/api/) all contract routes via request<T>
```

## Phases (fixtures-first; each ends green on the listed checks)

Per-phase verification — single-file runs only (big vitest batches mass-fail on
`React.act`): `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` ·
`pnpm --filter @qlan-ro/mainframe-ui typecheck`.

**Phase 0 — contract, domain, fixtures, shell plumbing.** `contract.ts`, `domain/*`,
`fixtures/*`, `data/gateway.ts` + stores + nav, `flags.ts`, host/view skeleton.
Mount the host in `AppShell.tsx` behind the nav store (v1 untouched; open v2 via a dev
affordance until Phase 6 swaps entry points). Tests: `domain/__tests__/tokens.test.ts`
(above-only scope, If leak, Repeat isolation + ⟨Current item⟩ fields, later-step
invisible, named camelCase outputs incl. A2 expects), `validate.test.ts` (out-of-scope
wording + stepId pinning, choice-without-options, unpicked action, missing producer),
`comparators.test.ts` (per type, no-value, is_one_of multi-value),
`command-preview.test.ts` (`"$MF_<n>"` substitution, single-quote/heredoc warning,
cwd excluded) — all keyed off fixture 6 (daily-feature-spike) for A1/A2/A3.

**Phase 1 — library + empty state.** `library/*`, `BlankState`, row → editor/run nav.
Tests: `LibraryRow.test.tsx` (toggle, Run now, testids keyed by automation id),
`LibraryList.test.tsx` (empty → BlankState with both paths).

**Phase 2 — field primitives.** `fields/*` (port `wf2-fields.jsx` faithfully:
draft-tail merge, backspace pops last part, Enter commits, slash menu on leading `/`,
picker disabled when scope empty, `⟨PR › URL⟩` field expansion). Tests:
`ChipField.test.tsx` (structural part-array assertions), `TokenPicker.test.tsx`
(grouping, field expansion, out-of-scope absence).

**Phase 3 — editor structure.** `editor/*` (port `wf2-editor.jsx`): WhenCard +
triggers (incl. webhook preset rows), recursive Recipe with scope accumulation,
Step/Block cards, If/Repeat bodies, ConditionRow, AddStepMenu, issue strips + footer.
Lazy-load `AutomationEditor`. Tests: `ConditionRow.test.tsx` (comparators per type,
choice dropdown, is_one_of multi-select, no-value hides input), `Recipe.test.tsx`
(tokens-before per card; If leak visible after the block), `StepCard.test.tsx`
(issue strip only on the offending stepId).

**Phase 4 — step configs + catalog + credentials.** `steps/*` (port
`wf2-stepconfig.jsx` onto contract action ids): four verb panels, MoreOptions,
FailureToggle everywhere, attachments, ExpectResultsBuilder (A2), CommandPreview in the
run_command form (A1), AutoForm from catalog metadata (showIf, credential, columns-map),
ActionCatalog embed-or-modal, CredentialConnect. Tests: `AskMeConfig.test.tsx` (field
CRUD, options chips, show-when), `AutoForm.test.tsx` (metadata → control, showIf),
`ExpectResultsBuilder.test.tsx` (keys become tokens), `ActionCatalog.test.tsx` (search +
source filter, split files.* entries present).

**Phase 5 — run view, notifications, describe.** `run/*`: timeline states
running/waiting/succeeded/failed/cancelled/skipped, inline paused form (submits via
gateway respond), Kept-going, Repeat fan-out (`#<iteration>` refs), "Open agent chat"
via the existing session-selection store action. `use-automation-toasts`
(`automation.notification` + completed/failed → mfToast with actions). `describe/*`:
full UI; "Draft it" returns a fixture draft behind `DESCRIBE_ENABLED` (no drafting
endpoint in the contract — Node-plan dependency; flag off in prod). Tests:
`RunView.test.tsx` (states + fan-out + kept-going), `RunInlineForm.test.tsx` (show-when,
submit payload), `use-automation-toasts.test.ts`.

**Phase 6 — live wiring.** `lib/api/automations.ts` + `http-gateway.ts`;
`use-automation-events.ts` switching on the five `automation.*` events ONLY (a failed
run is `automation.completed{status:'failed'}` — never subscribe `automation.failed`);
swap `contract.ts` to re-export `@qlan-ro/mainframe-types`; move `domain/` into
`packages/types` (if types/events haven't landed, keep the local module and file the
swap as the blocking follow-up); re-point fixtures to the canonical JSON. Swap entry
points: `SidebarHeader.tsx` opens Automations (badge = pending interaction count),
`AppShell.tsx` mounts only `AutomationsHost`. Tests: `api-automations.test.ts` (paths +
envelope), `use-automation-events.test.ts`. Manual pass against the dev daemon.

**Phase 7 — delete v1 + cleanup + changeset.** Deletion list below; remove the five
`--mf-wf-*` tokens + their `@theme` mappings from `globals.css` (re-home verb colors as
`--mf-auto-*`); sweep dead imports; `pnpm changeset` (minor, `@qlan-ro/mainframe-ui`).
Final gate: **design-conformance** agent against `docs/designs/wf2-prototype/` + theme
contract for library, editor, token picker, catalog, run view (A1 preview + A2
Expect-results have no artboards — review against this plan instead).

## Deletion inventory (Phase 7 — v1 workflows UI dies entirely)

- `packages/ui/src/features/workflows/` — whole tree (verified against main): 13
  top-level `Wf*`/`Workflows*` components + `glyphs.ts`, the 4 `use-workflows-*` hooks/
  stores, `editor/` (10 files incl. `WorkflowEditor.tsx`, `WfBuilderPane.tsx`,
  `WfStepLibrary.tsx`, `WfYamlPane.tsx`, `yaml-serialize.ts`, `wf-draft-types.ts`,
  `wf-slug.ts`), and all `__tests__/`. Re-confirm the exact file set at execution.
- `packages/ui/src/lib/api/workflows.ts`.
- UI Phase 7 owns (contract §7): delete `packages/e2e/tests-tauri/workflows.spec.ts`;
  edit `packages/e2e/tests-tauri/sidebar-chrome.spec.ts` (drop workflows nav assertions).
- Edits, not deletions: `app/AppShell.tsx` (import + mount), `layout/SidebarHeader.tsx`
  (`WorkflowsBtn` → automations open + badge source), `styles/globals.css` (`--mf-wf-*`).
- Keep: `BackgroundActivityBar` 'workflow' task kind, `lib/model-tuning.ts` copy,
  `chat-thread-state.ts` comment — unrelated "workflow" strings.
- NOT this plan: `packages/types/src/workflow.ts`, `workflow.*` events, core routes —
  the daemon plans own those deletions.

## Testing strategy

Test authoring is delegated to the **test-writer** agent at implementation time, phase by
phase, with the assertions above (hardcoded expectations, behavior-based, structural
chip-part assertions — no rendered-string round-trips). Every interactive element carries
a testid per the naming rule; coverage thresholds not lowered. Acceptance =
design-conformance pass + the six §12 automations fully authorable/inspectable against
fixtures (which exercise A1–A3 per contract §8).

## Risks

- **assistant-ui interop.** The host lives outside the aui thread tree (as v1 did);
  contact points are session navigation and toasts only. Reuse the existing
  session-selection store action; never touch aui internals from automations code.
- **Editor perf on deep recipes.** Scope accumulation is O(steps×tokens) per render;
  spec bounds nesting (≤2). `useMemo` the validate pass, keep `ChipField` draft state
  local (commit on blur/Enter), memoize `StepCard` on `(step, tokensBefore, issues)`.
  Virtualize only run lists (virtuoso), never the recipe.
- **Describe-it dependency.** No drafting endpoint → behind `DESCRIBE_ENABLED=false`
  with a fixture draft; Node-plan follow-up. Build-it ships fully regardless.
- **Contract drift.** Types owned by the Node plan; every UI import goes through
  `contract.ts` (one-file swap). Canonical JSON fixtures are the tie-breaker; the
  prototype's action shapes (single Files action, `github_pr_*` events) are already
  resolved divergences.
- **No artboards for A1/A2.** Style CommandPreview and ExpectResultsBuilder from the
  existing form idioms; flag for user review at the Phase 4 checkpoint (design-conformance
  can't cover them). Webhook sample capture is likewise unrouted → placeholder state.
- **First React.lazy in the package.** Verify Vite chunking in the app-tauri shell at
  Phase 3 (`pnpm build`); fallback is a plain spinner, no layout shift.
- **Repeat fan-out cap.** Engine fails a Repeat over `MAX_REPEAT_ITEMS` (500, §2); the
  run view renders it as a normal failed step, not a crash.
