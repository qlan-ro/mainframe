# Implementation plan — Claude "Auto" permission mode

Todo #325 · route: full · branch `todo/325-claude-auto-permissions-mode`
Spec: `docs/specs/2026-08-14-todo-325-claude-auto-permissions-mode.md`

## Goal

Add the Claude CLI's native `auto` permission mode as a fourth value of Mainframe's one canonical
execution mode, carried end-to-end: the shared TypeScript union and its Rust mirror gain `auto`; a
new `autoMode` capability flag on the existing adapter-capabilities contract says who supports it
(Claude yes, Codex no); the Claude adapter maps it 1:1 to the CLI's `--permission-mode auto` at
spawn and to the same value on the mid-session `set_permission_mode` control request, so plan-mode
restore returns to `auto` like any other base mode; the Codex adapter handles the variant as an
explicit arm that coerces to its Interactive policy and logs the coercion instead of falling
through; and the four surfaces that list modes — the composer picker, the provider default-mode
radio, the automations Ask-Agent chip, and the plan gate's exec-mode segmented control — offer Auto
only when the resolved adapter advertises the capability, with a caution (warning) tint that is
visibly not the destructive tint Unattended keeps. The approval gate itself is untouched.

## Constraints

- Max 300 lines/file, 50 lines/function (root `CLAUDE.md`). No file here approaches either.
- Single canonical type: `ExecutionMode` is defined once in `@qlan-ro/mainframe-types` and mirrored
  in `mainframe-types` (Rust). Both mirrors move in the same commit or the wire desyncs.
- The daemon WS/REST contract is co-owned by the mobile submodule: changes must be **additive**.
  `autoMode` is a new optional key on an existing object; `auto` is a new value of an existing
  field. Do not bump the submodule pointer.
- `data-testid` on every new interactive element, kebab-case, following the existing naming.
- No `console.*` in core; Rust logs via `tracing`.
- A changeset is required (`.changeset/`), and `docs/plans/` is gitignored — commit with `git add -f`.
- Read the `mainframe-design-system` skill before writing any markup or class names in `packages/ui`.

## Established facts

Verified while planning. Downstream implementers and reviewers should trust these rather than
re-deriving them.

- Installed Claude CLI is **2.1.224** (`claude --version`).
- `--permission-mode` accepts `auto`. Probing an invalid value prints the allow-list:
  `error: option '--permission-mode <mode>' argument 'zzz' is invalid. Allowed choices are
  acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.` (`claude --permission-mode zzz -p ""`,
  run 2026-08-14).
- `default` still passes CLI argument validation on 2.1.224 even though help now lists `manual`
  instead: `claude --permission-mode default -p ""` fails only later, with
  `Error: Input must be provided either through stdin or as a prompt argument when using --print`.
  The existing spawn path is therefore not broken by the rename.
- `auto` is in the CLI's `EXTERNAL_PERMISSION_MODES` as of 2.1.220, which is what makes both
  `--permission-mode auto` and the `setMode: auto` control request validate —
  `docs/adapters/claude/PERMISSIONS.md:213`.
- The mid-session control request Mainframe sends is `{"subtype":"set_permission_mode","mode":<cli mode>}`
  and it is forwarded session-scoped — `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs:786-790`,
  `docs/adapters/claude/PERMISSIONS.md:296`.
- Plan-mode restore reads a single stored string, not an enum: `base_permission_mode: Mutex<String>`
  is set from `execution_mode_cli(mode)` on every `set_permission_mode` and replayed verbatim by
  `set_plan_mode(false)` — `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs:333, 749-783`.
  Nothing there needs a new branch; it inherits `auto` once the mapping emits it.
- The chat-config route validates `permissionMode` purely by serde enum parse — a bad string fails
  `parse_body` and returns 400 — `packages/core-rs/crates/mainframe-server/src/routes/chat_commands.rs:88-110`.
  This is the **only** deserialization site for that field: `update_chat_config` has no WS message
  path (grep for `update_chat_config` finds only the REST route, `chat_manager/config_api.rs`, and
  `config_manager.rs`).
- The provider-settings route does **not** use serde for the mode: `validate_provider_patch` hardcodes
  `in_enum(&p.default_mode, &["default", "acceptEdits", "yolo"])` —
  `packages/core-rs/crates/mainframe-server/src/routes/settings.rs:492`. Widening the enum alone
  leaves this rejecting `auto`. The same file already converted the effort list to a serde-driven
  check (`is_effort_or_clear`, `settings.rs:481-489`) precisely to stop this class of desync.
- The stored chat mode is written as a raw string and parsed on read with
  `serde_json::from_value::<ExecutionMode>` — `packages/core-rs/crates/mainframe-db/src/chats.rs:84-88, 699`.
  So `auto` persists and round-trips automatically once the enum has the variant; an unparseable
  value reads back as `None`, unchanged.
- Automations never validate the mode string: `AskAgentStep.permission_mode` is
  `Option<String>` (`packages/core-rs/crates/mainframe-automations/src/domain/step.rs:105`), passed
  through `AgentRequest` (`ports/agent.rs:29`) into `create_chat_with_defaults` as `Option<&str>`
  (`packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs:283-289`). No allow-list blocks
  `auto` on that path.
- `AdapterCapabilities` (Rust) is a plain struct with one field and **nine** literal construction
  sites, so adding a field is compiler-enforced everywhere:
  `mainframe-adapter-claude/src/adapter.rs:125`, `mainframe-adapter-codex/src/adapter.rs:165`,
  `mainframe-adapter-mock/src/adapter.rs:93`, `mainframe-adapter-api/tests/registry.rs:202`,
  `mainframe-chat/src/context_tracker.rs:421`, `mainframe-server/tests/chat_default_model_catalog.rs:55`,
  `mainframe-server/tests/transcript_presence_support/mod.rs:66`, and twice in
  `mainframe-server/src/routes/session_transcripts.rs:154, 198`.
- TypeScript declares the capabilities object **twice** — `AdapterInfo.capabilities`
  (`packages/types/src/adapter.ts:239-241`) and `Adapter.capabilities`
  (`packages/types/src/adapter.ts:358-360`). Both need the new key.
- Two TS maps are keyed `Record<ExecutionMode, …>` and therefore break the moment the union widens:
  `EXEC_MODE_LABELS` (`packages/ui/src/features/chat/messages/PlanBubble.tsx:26`) and `MODE_COPY`
  (`packages/ui/src/features/automations/steps/agent/PermissionMenu.tsx:25`).
- The `--warning` token is live and first-class in the UI theme: declared at
  `packages/ui/src/styles/globals.css:137` (light) / `:180` (dark), exported as `--color-warning`
  at `:77`, and already used as `text-warning` / `bg-warning/10` on the gate surface
  (`packages/ui/src/features/chat/gates/PermissionGate.tsx:101`).
- The adapters store seeds a placeholder identity with `capabilities: { planMode: false }` before
  the real snapshot arrives — `packages/ui/src/store/adapters.ts:71-84`. That is spec edge case 1.
- `packages/types/dist/` is **not** git-tracked (`git ls-files packages/types/dist` is empty); the
  stale `dist/settings.d.ts` on disk is a build artifact and needs no edit, only a rebuild.

## Decisions taken in-lane

1. **`autoMode` is optional in TypeScript, required in Rust.** TS: `autoMode?: boolean` on both
   capabilities declarations — absent means unsupported, which keeps the change additive for mobile
   and leaves every existing TS fixture compiling. Rust: `pub auto_mode: bool`, no default, so the
   compiler forces a considered value at all nine construction sites.
2. **The mock adapter reports `auto_mode: false`.** The e2e suite drives the mock adapter, so Auto
   never appears in a Playwright run and no existing spec (`composer.spec.ts`, `settings.spec.ts`,
   `gates.spec.ts`, …) changes. Both capability directions are covered in vitest instead.
3. **The plan gate's exec-mode control gains a capability-gated Auto segment, but its initial value
   stays `'default'`.** Adding the segment closes the hole where an Auto user approving a plan can
   only pick from three modes. Seeding the control from the chat's current mode would also change
   behavior for Unattended users (today the gate always defaults to the safest mode) — out of scope
   here; noted as a follow-up. Cheap alternative if the reviewer wants less scope: skip Group G
   entirely and document that plan approval always re-picks from the original three.
4. **`resolveStepAdapter` is extracted** from `steps/agent/ModelMenu.tsx` into
   `steps/agent/resolve-step-adapter.ts` and shared with `PermissionMenu`. Two call sites is below
   the 3+ extraction rule, but the fallback chain (`by id → first installed → first`) is exactly the
   kind of subtlety that drifts when copied, and a step's model chip and permission chip disagreeing
   about which provider they describe would be a visible bug.
5. **The provider-settings allow-list becomes serde-driven** rather than gaining a fourth hardcoded
   string, following the `is_effort_or_clear` precedent in the same file. This removes the desync
   class rather than paying it again.
6. **Copy is fixed by the spec:** label `Auto`, description "Claude decides which actions need
   approval". Do not editorialize it into a promise of fewer prompts.

## Task groups

Cross-group red-phase TDD is not achievable here: in **both** languages a test that names the new
mode fails to *compile* until the enum widens, so a separate "tests first" group would only produce
a build break for every other group. Each group therefore runs test-first internally — the task
order below is the TDD order, and it is binding.

---

### Group A — `core-types` (tasks 1–6) · kind: core · depends on: nothing

Widens both mirrors of the mode and the capabilities contract, plus every edit the compiler forces.
Leaves `cargo check` and the UI typecheck green.

**Task 1 (red).** In `packages/core-rs/crates/mainframe-types/src/settings.rs`, in the existing
`mod tests`, extend `execution_mode_serializes_camelcase` with
`assert_eq!(serde_json::to_string(&ExecutionMode::Auto).unwrap(), "\"auto\"")`, add
`permission_mode_auto_serializes_as_auto` for `PermissionMode::Auto`, add a round-trip assertion
that `serde_json::from_str::<ExecutionMode>("\"auto\"")` yields `ExecutionMode::Auto`, and add
`execution_modes_constant_lists_four_modes_in_permissiveness_order` asserting `EXECUTION_MODES ==
[Default, AcceptEdits, Auto, Yolo]`.
*Verify:* `cargo test -p mainframe-types settings` from `packages/core-rs` fails to compile
(`no variant named Auto`). That is the red.

**Task 2 (green).** Same file: add `Auto` to `ExecutionMode` (between `AcceptEdits` and `Yolo`), add
`Auto` to `PermissionMode` (same position), and widen `EXECUTION_MODES` to
`[ExecutionMode; 4]` with `ExecutionMode::Auto` third. Update the `PORT STATUS` note at the bottom of
the file to record the fourth variant.
*Verify:* `cargo test -p mainframe-types settings` passes.

**Task 3.** Add `pub auto_mode: bool` to `AdapterCapabilities` in
`packages/core-rs/crates/mainframe-types/src/adapter.rs:299-303` (one-line doc comment: which
adapters advertise the CLI's native `auto` mode). Then set it at all nine construction sites:
`true` in `mainframe-adapter-claude/src/adapter.rs:125`; `false` in
`mainframe-adapter-codex/src/adapter.rs:165`, `mainframe-adapter-mock/src/adapter.rs:93`,
`mainframe-adapter-api/tests/registry.rs:202`, `mainframe-chat/src/context_tracker.rs:421`,
`mainframe-server/tests/chat_default_model_catalog.rs:55`,
`mainframe-server/tests/transcript_presence_support/mod.rs:66`, and both sites in
`mainframe-server/src/routes/session_transcripts.rs:154, 198`.
*Verify:* `cargo check --workspace --all-targets` from `packages/core-rs` is green.

**Task 4.** Adapter mode mappings.
- `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs:235-240` — add
  `ExecutionMode::Auto => "auto"` to `execution_mode_cli`.
- `packages/core-rs/crates/mainframe-adapter-codex/src/session.rs:163-169` — replace the
  `if mode == ExecutionMode::Yolo { … } else { … }` body of `map_permission_mode` with a delegation
  to a new free function `fn permission_mode_policy(mode: ExecutionMode) -> (String, String)` in the
  same file, written as an exhaustive `match` with four explicit arms: `Yolo` →
  `("never", "danger-full-access")`; `Default` and `AcceptEdits` → `("on-request", "workspace-write")`;
  `Auto` → the same Interactive pair, preceded by
  `tracing::warn!("chat is set to the Claude-only `auto` permission mode; Codex runs it as Interactive")`.
  A free function keeps the mapping unit-testable without constructing a `CodexSession`.
- Add `permission_mode_policy_coerces_auto_to_interactive` to the `mod tests` at
  `mainframe-adapter-codex/src/session.rs:828`, asserting `Auto` and `Default` produce the identical
  pair and that `Yolo` still produces the danger pair.
*Verify:* `cargo test -p mainframe-adapter-codex permission_mode_policy` passes;
`cargo check --workspace --all-targets` green.

**Task 5.** TypeScript mirrors.
- `packages/types/src/settings.ts:3` — `export const EXECUTION_MODES = ['default', 'acceptEdits', 'auto', 'yolo'] as const;`
- `packages/types/src/adapter.ts:239-241` and `:358-360` — add `autoMode?: boolean;` to both
  capabilities objects, with a one-line comment that absent means unsupported (mobile-additive).
*Verify:* `pnpm --filter @qlan-ro/mainframe-types build` succeeds.

**Task 6.** Compile-forced TS consumers.
- `packages/ui/src/features/chat/messages/PlanBubble.tsx:26-30` — add `auto: 'Auto'` to
  `EXEC_MODE_LABELS`.
- `packages/ui/src/features/automations/steps/agent/PermissionMenu.tsx:25-29` — add
  `auto: { label: 'Auto', hint: 'Claude decides which actions need approval' }` to `MODE_COPY`.
  Copy only; the capability filtering is Group F.
*Verify:* `pnpm --filter @qlan-ro/mainframe-ui typecheck` is green and reports no other
`Record<ExecutionMode, …>` breakage.

---

### Group B — `core-claude` (tasks 7–9) · kind: test · depends on: `core-types`

Pins the Claude spawn, control-request and plan-restore behavior for `auto`. Shares
`adapter-claude/src/session.rs` with Group A, so it must run after it.

**Task 7.** In `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs` `mod tests`
(alongside `accept_edits_mode_passes_permission_mode_accept_edits`, line ~1345), add
`auto_mode_passes_permission_mode_auto`: `build_args(&spawn_opts(Some(ExecutionMode::Auto)), &None)`
→ `mode_arg(&args) == "auto"`.
*Verify:* `cargo test -p mainframe-adapter-claude auto_mode_passes` passes.

**Task 8.** Same test module, alongside `set_permission_mode_maps_yolo_to_bypass_permissions`
(line ~1435), add two tests:
- `set_permission_mode_sends_auto_verbatim` — after `s.set_permission_mode(ExecutionMode::Auto)`, the
  captured control payload has `request.subtype == "set_permission_mode"` and `request.mode == "auto"`.
- `leaving_plan_mode_restores_auto` — `set_permission_mode(Auto)`, then `set_plan_mode(true)` (payload
  mode `"plan"`), then `set_plan_mode(false)` → payload mode `"auto"`, not `"default"`. Follow the
  existing spawned-session harness used at lines ~1423-1500.
*Verify:* `cargo test -p mainframe-adapter-claude permission_mode` passes.

**Task 9.** In `packages/core-rs/crates/mainframe-adapter-claude/src/plan_mode_handler.rs` `mod tests`
(the recorder harness at lines ~141-260), add `on_approve_with_auto_sets_auto_base_mode`: a
`ControlResponse` carrying `execution_mode: Some(ExecutionMode::Auto)` results in
`rec.set_permission_mode == vec![ExecutionMode::Auto]` and a `PlanChatUpdate` with
`plan_mode: Some(false)` and `permission_mode: Some(ExecutionMode::Auto)`.
*Verify:* `cargo test -p mainframe-adapter-claude plan_mode_handler` passes.

---

### Group C — `core-routes-db` (tasks 10–12) · kind: core · depends on: `core-types`

The two validation/persistence gaps the enum widening does not close by itself.

**Task 10 (test first, then fix).** In `packages/core-rs/crates/mainframe-server/tests/routes_settings.rs`,
add a case that `PATCH`es a provider patch with `defaultMode: "auto"` and expects 200 plus `auto` on
the subsequent read, and a case with `defaultMode: "bogus"` expecting the existing 400 shape. Watch it
fail. Then in `packages/core-rs/crates/mainframe-server/src/routes/settings.rs`, replace
`in_enum(&p.default_mode, &["default", "acceptEdits", "yolo"])` at line 492 with a new
`fn is_execution_mode(value: &Option<String>) -> bool` modeled on `is_effort_or_clear`
(lines 481-489): `None` → true, otherwise `serde_json::from_value::<ExecutionMode>(Value::String(v.clone())).is_ok()`.
Do **not** admit `""` — the current check does not, and `set_or_delete` semantics for this field are
unchanged. Import `ExecutionMode` alongside the existing `EffortLevel` import.
*Verify:* `cargo test -p mainframe-server --test routes_settings` passes.

**Task 11.** In the `#[cfg(test)] mod tests` at
`packages/core-rs/crates/mainframe-server/src/routes/chat_commands.rs:267`, add
`update_chat_config_body_accepts_auto` (`parse_body::<UpdateChatConfigBody>(br#"{"permissionMode":"auto"}"#)`
→ `Some` with `permission_mode == Some(ExecutionMode::Auto)`) and
`update_chat_config_body_rejects_unknown_mode` (`{"permissionMode":"turbo"}` → `None`, which is what
the route turns into the existing 400). This is the route's only validation seam; an end-to-end HTTP
test is not available because `AppCtx.chat_manager` is absent in the integration harness and the
handler short-circuits to 500 before touching the body.
*Verify:* `cargo test -p mainframe-server chat_commands` passes.

**Task 12.** In `packages/core-rs/crates/mainframe-db/tests/chats.rs`, add
`permission_mode_auto_survives_a_reopen`: build with `setup_with_conn()`, create a chat with
`permission_mode = Some("auto")`, then construct a **second** `ChatsRepository` over the same
`Rc<Connection>` (the in-memory stand-in for a daemon restart) and assert the re-read chat reports
`Some(ExecutionMode::Auto)`. Add a sibling assertion that a junk value (`"turbo"`) still reads back as
`None` rather than erroring, pinning spec edge case 3.
*Verify:* `cargo test -p mainframe-db --test chats permission_mode` passes.

---

### Group D — `ui-picker` (tasks 13–15) · kind: ui · depends on: `core-types`

**Task 13 (red).** Extend
`packages/ui/src/features/chat/composer/config-toolbar/__tests__/PermissionSelect.test.tsx` with four
cases: (a) Auto option renders when the passed adapter has `capabilities.autoMode === true`;
(b) it does not render when `autoMode` is `false` **and** when the capabilities object omits the key
entirely (the placeholder-adapter case); (c) with `chat.permissionMode === 'auto'` and no adapter
passed, the trigger label still reads `Auto`, never the raw mode string; (d) the Auto option and the
Auto trigger carry `text-warning` and do **not** carry `text-destructive`, while Unattended still does.
Use `data-testid="composer-permission-mode-select-option-auto"`.
*Verify:* `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/config-toolbar/__tests__/PermissionSelect.test.tsx` fails on all four.

**Task 14 (green).** `packages/ui/src/features/chat/composer/config-toolbar/PermissionSelect.tsx`:
add an optional `adapter?: AdapterInfo` prop; add a fourth entry to `PERMISSION_MODES` between
`acceptEdits` and `yolo` — `{ id: 'auto', label: 'Auto', description: 'Claude decides which actions need approval', tone: 'caution' }`
(give `yolo` `tone: 'destructive'` and the other two no tone); keep **one** unfiltered list and derive
`currentLabel` from it (line 44) so a filtered-out mode never leaks a raw string; render
`PERMISSION_MODES.filter((m) => m.id !== 'auto' || adapter?.capabilities.autoMode === true)`; replace
the `isYolo ? 'text-destructive' : 'text-muted-foreground'` trigger tint (line 62) with a
three-way tone lookup (`destructive` → `text-destructive`, `caution` → `text-warning`, else
`text-muted-foreground`) and apply the same tone class to the option's label span. Update the file's
header comment, which currently claims a fixed three-mode list.
*Verify:* the Task 13 tests pass; `pnpm --filter @qlan-ro/mainframe-ui typecheck` green.

**Task 15.** `packages/ui/src/features/chat/composer/config-toolbar/ComposerToolbar.tsx:65` — pass
`adapter={adapter}` (already resolved on line 29). `packages/ui/src/store/adapters.ts:83` — add
`autoMode: false` to the placeholder `capabilities` literal and extend the adjacent comment to say the
placeholder under-reports capabilities on purpose.
*Verify:* `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/config-toolbar/__tests__ src/store/__tests__/adapters.test.ts` passes.

---

### Group E — `ui-settings` (tasks 16–17) · kind: ui · depends on: `core-types`

**Task 16 (red).** New file
`packages/ui/src/features/settings/panes/providers/__tests__/SessionModeRadio.test.tsx`: Auto radio
(`data-testid="settings-claude-mode-option-auto"`) renders for an adapter with `autoMode: true`;
absent for one without; the Auto row uses the warning tint and not the destructive tint Unattended
keeps; selecting it calls `onChange({ defaultMode: 'auto' })`.
*Verify:* the file fails.

**Task 17 (green).** `packages/ui/src/features/settings/settings-tabs.ts:15-33` — add the `auto`
entry between `acceptEdits` and `yolo` (`label: 'Auto'`, `description: 'Claude decides which actions need approval'`)
and add a `caution?: boolean` flag alongside the existing `danger?: boolean`, set on the new entry
only. `packages/ui/src/features/settings/panes/providers/SessionModeRadio.tsx` — accept an
`adapter: AdapterInfo` prop, filter the `auto` entry out unless `adapter.capabilities.autoMode`, and
map `caution` to `border-warning/50 text-warning` on the radio item plus `text-warning` on the label,
mirroring the existing `danger` branch on lines 30 and 33. Update the "Three-option radio group"
doc comment. `ProviderConfigForm.tsx:139` — pass `adapter={adapter}` (already in scope, see line 177).
*Verify:* Task 16 tests pass; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/settings/panes/providers/__tests__` all green.

---

### Group F — `ui-automations` (tasks 18–20) · kind: ui · depends on: `core-types`

Shares `steps/agent/PermissionMenu.tsx` with Group A (Task 6), so it must run after it.

**Task 18 (red).** Extend
`packages/ui/src/features/automations/steps/agent/__tests__/PermissionMenu.test.tsx`: with an
adapters store seeded so that `claude` has `autoMode: true` and `codex` does not, a menu given
`adapterId="claude"` lists `…-permission-option-auto` and one given `adapterId="codex"` does not; a
step whose stored `permissionMode` is `'auto'` on a non-supporting provider still shows the chip
label `Auto` rather than falling back to `Interactive`. Note that the existing test iterates
`EXECUTION_MODES` wholesale (line 29) — that loop must be scoped to the supporting provider.
*Verify:* fails.

**Task 19.** Create `packages/ui/src/features/automations/steps/agent/resolve-step-adapter.ts`
exporting the `resolveAdapter` function currently private in `ModelMenu.tsx:31-33`
(`by id → first installed → first`), and import it in `ModelMenu.tsx` in place of the local copy.
No behavior change.
*Verify:* `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/steps/agent/__tests__/ModelMenu.test.tsx` still passes.

**Task 20 (green).** `packages/ui/src/features/automations/steps/agent/PermissionMenu.tsx` — add an
`adapterId: string | undefined` prop, resolve the adapter with `useAdapters()` + `resolveStepAdapter`,
keep `active` resolution against the full `EXECUTION_MODES` (so the label is right either way) and
filter only the rendered list; pass `caution` to `ChipButton` when `active === 'auto'` (add a
`caution?: boolean` prop to `packages/ui/src/features/automations/steps/agent/ChipButton.tsx`
alongside its existing `destructive`, mapping to `text-warning`). Update the file header, which
currently states the list comes straight from the contract. `steps/AgentConfig.tsx:57` — pass
`adapterId={step.adapterId}`.
*Verify:* Task 18 tests pass; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/steps/agent/__tests__ src/features/automations/steps/__tests__/AgentConfig.test.tsx` green.

---

### Group G — `ui-plan-gate` (tasks 21–22) · kind: ui · depends on: `core-types`

**Task 21 (red).** New file
`packages/ui/src/features/chat/gates/__tests__/PlanExecModeControl.test.tsx`: the Auto segment
(`data-testid="chat-plan-execmode-auto"`) renders when `autoAllowed` is true, is absent when it is
false or omitted, sits between Auto-edits and Unattended, and when selected carries `text-warning`
while a selected Unattended still carries `text-destructive`.
*Verify:* fails.

**Task 22 (green).** `packages/ui/src/features/chat/gates/PlanExecModeControl.tsx` — add an
`autoAllowed?: boolean` prop and a fourth `EXEC_MODE_OPTIONS` entry
(`{ id: 'auto', label: 'Auto', Icon: SparklesIcon, desc: 'Claude decides which actions need approval' }`)
placed third, filtered out unless `autoAllowed`; extend the two-way selected tint (lines 50-51) to a
three-way one so a selected `auto` reads `bg-background text-warning shadow-sm`.
`packages/ui/src/features/chat/gates/PlanGate.tsx` — resolve the chat's adapter from
`useChatExtras()?.state.chatConfig?.adapterId` plus `useAdapters()` and pass
`autoAllowed={adapter?.capabilities.autoMode === true}` down through `ControlsPanel` to the control.
Leave the `useState<ExecutionMode>('default')` seed on line 136 untouched (decision 3).
*Verify:* Task 21 tests pass; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/PlanGate.test.tsx src/features/chat/gates/__tests__/PlanExecModeControl.test.tsx` green.

---

### Group H — `docs-changeset` (tasks 23–24) · kind: core · depends on: nothing

**Task 23.** `docs/adapters/claude/PERMISSIONS.md` — rewrite the `auto` row (line 213) to record the
2026-08-14 probe on CLI 2.1.224: the mode is external, `--permission-mode auto` and `setMode: auto`
both validate, and the classifier is live (the probe allowed a file write, a network `curl` and an
`rm`, where `acceptEdits` refused the network call). State the minimum CLI version Mainframe requires
for Auto — **2.1.220**, where `auto` entered `EXTERNAL_PERMISSION_MODES` — and note that Mainframe now
exposes the mode through the `autoMode` adapter capability. In the same table's surrounding prose, note
that 2.1.224 renamed the interactive mode to `manual` in `--permission-mode` help while still accepting
`default`, so Mainframe's spawn path is unaffected (spec "Not Included").
*Verify:* the file states a concrete minimum version and no other row is edited (`git diff --stat`).

**Task 24.** Add `.changeset/claude-auto-permission-mode.md` bumping `'@qlan-ro/mainframe-types'` and
`'@qlan-ro/mainframe-ui'` **minor** (a new user-facing mode and a new contract value), with a
one-sentence summary in the house style of `.changeset/adapter-model-catalog-fixes.md`.
*Verify:* the file parses (`pnpm changeset status` runs without error).

---

## Verification before handing the branch back

1. `cargo check --workspace --all-targets` and `cargo test --workspace` from `packages/core-rs`.
2. `pnpm --filter @qlan-ro/mainframe-types build`, then
   `pnpm --filter @qlan-ro/mainframe-ui typecheck`.
3. Targeted vitest per Groups D–G (single files, per the repo's batch-`React.act` caveat).
4. One e2e run at the end of the series, not per group. Expect zero spec changes: the mock adapter
   reports `auto_mode: false`, so no Playwright surface lists Auto.

## Acceptance-criteria coverage notes

Three of the spec's sixteen criteria are satisfied without a task of their own. Reviewers should
check these claims rather than look for a missing task.

- **AC1, TypeScript side.** The spec asks for a serialization test on each side. `ExecutionMode` is a
  string-literal union derived from `EXECUTION_MODES`, so the wire value *is* the literal `'auto'` by
  construction — there is no encoder to test. Task 13 nevertheless asserts the picker renders
  `data-testid="composer-permission-mode-select-option-auto"`, which fails if the constant carries any
  other spelling. The Rust round-trip test (Task 1) is the real serialization guard.
- **AC11, gate invariance.** No task touches the gate because nothing in the gate path reads the
  permission mode: `ChatGateMount` dispatches on `ControlRequest.toolName`, and `PermissionGate` /
  `AskUserQuestionGate` / `PlanGate` receive only the request entry and the reply function. A tool use
  the CLI auto-allows never produces a `control_request` at all, so it cannot reach them. The existing
  `packages/ui/src/features/chat/gates/__tests__/PermissionGate.test.tsx` suite therefore covers AC11
  unchanged; run it in the Group G verification pass and record that it is green.
- **AC12, the inheritance leg.** A new chat with no explicit mode inherits the provider default as a
  raw string: `create_chat_with_defaults` reads `<adapterId>.defaultMode` from settings and passes it
  straight through (`packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs:296-320`) into the
  same insert Task 12 round-trips. Task 10 proves the setting can hold `auto`; Task 12 proves the row
  reads back as `ExecutionMode::Auto`. No lifecycle test is added.

## Risks and open follow-ups

- **CLI floor is documented, not enforced.** A user on a CLI older than 2.1.220 who selects Auto gets
  a spawn-time argument error from the CLI. The spec declines version probing; the only mitigation is
  the docs line in Task 23.
- **The plan gate still defaults to Interactive on approval** (decision 3). An Auto user must re-pick
  Auto in the gate. Fixing this means seeding the control from the chat's current mode, which also
  changes Unattended behavior — worth its own todo.
- **`packages/mobile` is untouched.** The wire change is additive (a new enum value, a new optional
  capability key), so mobile ignores it; a mobile picker is a separate PR in that repo.
- **`PermissionMode::Auto` (the flattened enum that also carries `plan`) gains a variant that nothing
  constructs today.** It exists for mirror fidelity with the TS `PermissionMode` union and is asserted
  by Task 1 only. That is intentional, not dead code to be pruned.
