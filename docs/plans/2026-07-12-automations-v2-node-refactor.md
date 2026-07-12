# Automations v2 — Node Daemon Refactor Plan

> **For agentic workers:** execute task-by-task. Checkboxes track steps. Every task is TDD: write the named test file first, run it (expect FAIL), implement, run again (expect PASS), commit. Verify with `pnpm --filter @qlan-ro/mainframe-core exec vitest run <test>` and `pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit` unless a task says otherwise.

**Goal:** Replace the v1 YAML/JSONata workflow engine in the Node daemon with the Automations v2 model (spec: `docs/designs/2026-07-11-automations-v2-spec.md`): When-triggers + linear Do-steps, four verbs (ask_agent, ask_me, run_action, notify), two blocks (if, repeat), chip-token dataflow, GUI-owned storage — on the fixed shared contract so the parallel Rust plan implements the same types/REST/WS/SQLite surface.

**Architecture:** Build v2 side-by-side in `packages/core/src/automations/` with new `/api/automations*` routes; v1 stays green through Phases 0–8; Phase 9 deletes v1 wholesale (core, routes, types, UI feature dir, e2e spec, deps). Adapted from v1: checkpointed run engine, sweep scheduler + missed-fire policy, interaction pause/resume, agent-session step, `FileCredentialStore`, WS `emitEvent` plumbing. Pre-release (2.0.0-rc.x): **no v1 back-compat, no run migration; a one-time v1-YAML import is explicitly CUT.**

**Tech stack:** TypeScript strict/NodeNext, better-sqlite3, express + zod, cron-parser (internal only), `@modelcontextprotocol/sdk` (new dep), vitest.

## Global Constraints (CLAUDE.md)

- Max 300 lines/file, 50/function; zod on every endpoint; no sync I/O in the daemon (credentials store keeps its documented startup-only exception); pino via `createChildLogger`; no silent catches; `safeJsonArray` for JSON columns where arrays are parsed; WS4 envelope (`ok`/`okEmpty`/`fail`); tests for every new route/store/logic module; `data-testid` rules are UI-only (out of scope); changeset before commit; **do not touch `packages/mobile`**.

## Contract Resolutions (decisions this plan makes — Rust plan must mirror; flag to orchestrator)

1. **Reserved `TokenRef.stepId` values:** `trigger` (trigger tokens), `builtin` (outputs `today`, `now`), `current` (Repeat item; `field` digs into structured items). `field` is a dot-path for structured values (webhook payload, list items).
2. **Only the 3 contract tables are shared; `trigger_state` and `agent_waits` are engine-internal rebuildable caches, NOT contract** — the Rust plan keeps its own derived-state design and does not mirror them; both engines ignore unknown tables in the shared file. Node's `trigger_state(automation_id, trigger_id, next_fire_at, last_payload)` (schedule persistence + webhook sample) and `agent_waits(chat_id, run_id, step_ref, last_assistant_text)` are reconstructable from `automation_runs`. Run `checkpoint` JSON owns step results, `wakeAt`, and `error` (no extra columns on `automation_runs`; sweep scans non-terminal runs).
3. `step_ref` format: `<stepId>` top-level/if-branch; `<stepId>#<iteration>` inside Repeat.
4. **WS events:** the four contract events plus `automation.notification {runId, automationId, title, body, links}` (Notify step needs it; follows the existing `chat.notification` pattern).
5. **Webhook route** (contract addition): `POST /api/automation-webhooks/:hookId`, auth-exempt, HMAC-SHA256 via `crypto.timingSafeEqual`, accepts `X-Signature` and GitHub `X-Hub-Signature-256`. Per-hook secret lives in the credential file under reserved label `webhook:<hookId>` (contract §3). GitHub "PR opened/merged" triggers ship as webhook presets (no polling).
6. **Credentials routes:** `GET /api/automation-credentials` → `{labels}`; `GET /:label` → `{label, kind}` (never values); `PUT`/`DELETE /:label` per contract. Reserved `webhook:<hookId>` labels are managed by the webhook trigger, not user-facing credential CRUD.
7. **Schedules run in local time** (v1 used UTC); plain-language `SchedulePattern` compiles to cron internally — cron never crosses the API.
8. **Scoping:** a step may use tokens from steps strictly above it; If-branch step outputs visible to later siblings after the block; Repeat inner-step outputs are NOT addressable after the block; `current` valid only inside Repeat.
9. **Substitution is literal:** unset → `''`; number → `String()`; list → `join('\n')`; object → `JSON.stringify`.
10. **MCP servers** discovered from project `.mcp.json` + `~/.claude.json` `mcpServers` (stdio transport only at launch). Action id namespaces: builtins `run_command`, `files.append|write|read`, `http.request`; curated `github.create_pr|list_prs`, `notion.add_row`, `ado.create_item`; MCP `mcp:<server>:<tool>`.
11. `enabled=false` disarms triggers; manual run stays allowed. Old `workflows.db`/`workflow-credentials.json` files are orphaned on disk (pre-release; not deleted).

---

## Phase 0 — Shared types (`@qlan-ro/mainframe-types`)

### Task 1: Automation type model
**Files:** Create `packages/types/src/automation.ts`; Test `packages/types/src/__tests__/automation.test.ts`; Modify `packages/types/src/index.ts` (add `export * from './automation.js';`).
- [ ] Test: reserved-id constants (`TOKEN_STEP_TRIGGER='trigger'`, `TOKEN_STEP_BUILTIN='builtin'`, `TOKEN_STEP_CURRENT='current'`) and a compile-time fixture instantiating every step kind and trigger kind, including `ask_agent` with `expects`.
- [ ] Implement: `TokenRef {stepId, output, field?}`, `ChipPart = string | {token: TokenRef}`, `ChipText = ChipPart[]`; steps `AskAgentStep {kind:'ask_agent', prompt: ChipText, adapterId?, model?, permissionMode?, projectId?, worktree?: {baseBranch?, branchName: ChipText}, autoApprove?: string[], timeoutMinutes?, expects?: Array<{key, type:'text'|'number'|'list'|'choice', options?}>}` (A2 — declared keys become named outputs), `AskMeStep {kind:'ask_me', title, fields: AutomationFormField[]}` (field: `key, type:'text'|'number'|'choice'|'multi'|'textarea', label?, options?, required?, showWhen?: {key, equals}`), `RunActionStep {kind:'run_action', actionId, credential?, params: Record<string, ChipText>, outputAs?: 'text'|'lines'}`, `NotifyStep {kind:'notify', message: ChipText}`, `IfBlock {kind:'if', match:'all'|'any', conditions: ConditionRow[], then: AutomationStep[], otherwise: AutomationStep[]}`, `RepeatBlock {kind:'repeat', items: TokenRef, steps: AutomationStep[]}`; all extend `{id: string, keepGoing?: boolean}`. `Comparator = 'is'|'is_not'|'contains'|'starts_with'|'eq'|'lt'|'gt'|'is_empty'|'not_empty'|'is_one_of'` (A3; `contains` polymorphic: text substring / list membership; `is_one_of` takes an array value); `ConditionRow {token, comparator, value?: string|number|Array<string|number>}`. Triggers: `{id, kind:'schedule', schedule: SchedulePattern, onMissed:'run_once'|'skip'}` | `{id, kind:'event', event:'session.finished'|'automation.finished'|'automation.failed', automationId?}` | `{id, kind:'webhook', hookId}`; `SchedulePattern = {type:'daily',at} | {type:'weekdays',at} | {type:'weekly',days:number[],at} | {type:'every_n_hours',n}`. `AutomationDefinition {triggers, steps}`; `AutomationSummary {id,name,description,scope:'global'|'project',projectId,enabled,definition,createdAt,updatedAt}`; `AutomationRunStatus = 'running'|'waiting'|'succeeded'|'failed'|'cancelled'`; `AutomationRunSummary {id, automationId, status, trigger:{kind, tokens?}, startedAt, finishedAt, error}`; `AutomationTimelineEntry {stepRef, stepId, kind, status, outputPreview?, error?, chatId?, interactionId?, startedAt?, finishedAt?}`; `AutomationInteractionSummary {id, runId, stepRef, title, fields, status:'pending'|'answered'|'cancelled', createdAt, resolvedAt}` (no 'expired' — v2 interactions never time out; `cancelled` set when the run is cancelled); `ActionCatalogEntry {id, title, group:'builtin'|'connector'|'mcp', auth:'none'|'token', credentialLabelHint?, paramsSchema: unknown /*JSON Schema*/, outputs: Array<{name, type:'text'|'number'|'list'}>}`.
- [ ] Verify: `pnpm --filter @qlan-ro/mainframe-types build && pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/automation.test.ts`. Commit.

### Task 2: DaemonEvent additions
**Files:** Modify `packages/types/src/events.ts` (append after L97, keep `workflow.*` L89-97 untouched until Phase 9).
- [ ] Add: `automation.run.updated {run: AutomationRunSummary}`, `automation.interaction.created {interaction}`, `automation.interaction.resolved {interactionId, runId}`, `automation.completed {automationId, automationName, runId, status:'succeeded'|'failed', result: string}` (one event serves both chaining triggers; `result` = final ⟨its result⟩ token), `automation.notification {runId, automationId, title, body, links:{runId, chatIds: string[]}}`.
- [ ] Verify: types build + core `tsc --noEmit` (v1 untouched). Commit.

## Phase 1 — Storage, definition validation, tokens (`packages/core/src/automations/`)

### Task 3: DB + stores
**Files:** Create `automations/db.ts`, `automations/store/run-store.ts`, `automations/store/interaction-store.ts`; Tests `packages/core/src/__tests__/automations/db.test.ts`, `run-store.test.ts`, `interaction-store.test.ts`.
- [ ] Tests: `openAutomationDb` creates `automations`, `automation_runs`, `automation_interactions` per the contract DDL + internal `trigger_state`, `agent_waits`; WAL + FK on. RunStore: `createRun` (trigger JSON snapshot + definition snapshot inside checkpoint), `getRun`, `listRuns(automationId, limit)`, `loadResumable()` (status running|waiting), `patchCheckpoint(runId, fn)` (read-modify-write in a transaction), `finalizeRun`, 4MB cap per step outputs (throws with "write large data to a file" message, mirroring v1 `run-store.ts:46`). InteractionStore: `create/get/findPendingForStep(runId, stepRef)/listPending/claim` (atomic `pending`→`answered`|`cancelled`, port of v1 `store/interaction-store.ts:77`; `cancelPendingForRun(runId)` bulk-claims to `cancelled`; no expiry queries — v2 interactions never expire, see Task 18).
- [ ] Implement. Checkpoint shape (canonical, used by interpreter + timeline projection): `{steps: Record<stepRef, {stepId, kind, status:'succeeded'|'failed'|'waiting'|'skipped', outputs: Record<string,unknown>|null, error, startedAt, finishedAt, chatId?, interactionId?}>, wakeAt: number|null, error: string|null}`. DB file: `<dataDir>/automations.db`.
- [ ] Verify + commit.

### Task 4: Definition zod schema + canonical fixtures
**Files:** Create the six reference definitions as JSON at `packages/types/fixtures/automations/{daily-health-log,daily-standup,pr-auto-review,morning-pr-sweep,ship-work,daily-feature-spike}.json` (contract §7 — the cross-language tie-breaker artifact, NOT compiled into the package build; the Rust suite loads the same files by relative path); Create `automations/definition/schema.ts`, `automations/testing/fixtures.ts` (thin loader: `loadFixture(name): AutomationDefinition` reads + parses the JSON); Test `__tests__/automations/definition-schema.test.ts`.
- [ ] Tests: `AutomationDefinitionSchema` parses each of the six fixtures via `loadFixture`; the fixtures collectively exercise A1 (run_command chips), A2 (`expects` on the spike), A3 (`is_one_of` gate in ship-work); rejects unknown kind, empty step id, bad comparator, `is_one_of` without an array value, `every_n_hours` n<1, malformed ChipText.
- [ ] Implement `AutomationDefinitionSchema: z.ZodType<AutomationDefinition>` with `z.lazy` for nested blocks; export `StepSchema`, `TriggerSchema`. This is the single write-path validator for routes.
- [ ] Verify + commit.

### Task 5: Scope validator
**Files:** Create `automations/definition/validate.ts`; Test `__tests__/automations/scope-validate.test.ts`.
- [ ] Tests (structured errors `{stepId, message}` with plain-language text per spec §10): forward reference rejected; `current` outside Repeat rejected; If-branch outputs visible to later siblings; Repeat inner outputs NOT visible after block; duplicate step ids rejected; unknown `actionId` output name rejected when catalog provided; `trigger`/`builtin` always in scope.
- [ ] Implement `validateScopes(def, catalogOutputs?): ScopeError[]` — walk with a visible-token set per Decision 8.
- [ ] Verify + commit.

### Task 6: Token substitution
**Files:** Create `automations/tokens/substitute.ts`; Test `__tests__/automations/substitute.test.ts`.
- [ ] Tests: literal join of ChipText; unset token → `''`; number/list/object coercions per Decision 9; `field` dot-path into structured values; `builtin.today` (YYYY-MM-DD local) / `builtin.now` (ISO); `current` resolution with iteration stack; `resolveToken` returns raw typed value (for comparators/repeat) vs `renderChipText` returns string.
- [ ] Implement `TokenContext {trigger: Record<string,unknown>, steps: checkpoint.steps, currentItems: unknown[]}`, `resolveToken(ctx, ref): unknown`, `renderChipText(ctx, text): string`.
- [ ] Verify + commit. Phase gate: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/automations/ && pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit`.

## Phase 2 — Interpreter

### Task 7: Typed comparators
**Files:** Create `automations/engine/comparators.ts`; Test `__tests__/automations/comparators.test.ts`.
- [ ] Tests: full matrix — text is/is_not/starts_with; `contains` polymorphic (text substring AND list membership); numeric eq/lt/gt with string-number coercion; list is_empty/not_empty; `is_one_of` (A3): operand equals any element of the array value, with string-number coercion (e.g. `'s'` is one of `['xs','s']` → true); null/undefined operand → false (never throws); `evalConditions(rows, 'all'|'any', ctx)`.
- [ ] Implement + verify + commit.

### Task 8: Linear walk + keepGoing
**Files:** Create `automations/engine/interpreter.ts` (class `AutomationInterpreter`: `startRun`, serialized `advance` via inFlight map + AbortController, port of v1 `engine/engine.ts:48-96`), `automations/engine/walk.ts`, `automations/engine/types.ts` (`StepOutcome = completed {outputs} | wait {wakeAt, kind} | failed {error}`; `VerbPorts {runAction, askAgent, askMe, notify}` injected); Test `__tests__/automations/engine-linear.test.ts`.
- [ ] Tests (fake ports): sequential execution; outputs recorded in checkpoint by stepRef; failed step fails run + error in checkpoint; `keepGoing:true` records failure, continues, downstream tokens of the failed step → `''`; `automation.run.updated` emitted on start/park/finalize; `onRunFinalized` fires.
- [ ] Implement: replay = skip stepRefs already `succeeded|skipped` in checkpoint; `waiting` stepRef parks (ports re-entry guarded by scratch fields `chatId`/`interactionId` as in v1 `executors/agent.ts:25`).
- [ ] Verify + commit.

### Task 9: If + Repeat blocks
**Files:** Modify `automations/engine/walk.ts`; Test `__tests__/automations/engine-blocks.test.ts`.
- [ ] Tests: If picks then/otherwise via comparators; nested If in otherwise; Repeat over list token runs inner steps per item with stepRef `id#i`; ⟨current⟩ + field access inside; park mid-iteration resumes at same iteration after wake; repeat over empty list is a no-op success.
- [ ] Implement + verify + commit.

### Task 10: Resume, cancel, park/wake
**Files:** Modify `automations/engine/interpreter.ts`; Test `__tests__/automations/engine-resume.test.ts`.
- [ ] Tests: new interpreter over same DB resumes a `running` run without re-executing committed steps (fake action counts calls); `cancelRun` aborts signal, finalizes `cancelled`, and calls `interactions.cancelPendingForRun(runId)` (any pending ask_me → `cancelled`); `wakeAt` deadline: sweep marks waiting ask_agent step failed ("agent step deadline exceeded") and advances.
- [ ] Implement + verify + commit.

## Phase 3 — Actions

### Task 11: Registry + catalog
**Files:** Create `automations/actions/types.ts` (`ActionDef {id, title, group, auth, input: ZodType, outputs, run(ctx, input)}`; `ActionCtx` ports v1 `connectors/types.ts:13` — creds, idempotencyKey, signal, logger, resolvePath), `automations/actions/registry.ts` (flat-id `register/resolve/catalog()` → `ActionCatalogEntry[]` via `z.toJSONSchema`); Test `__tests__/automations/action-registry.test.ts`.
- [ ] Verify + commit.

### Task 12: run_command (A1 — chips never touch shell source)
**Files:** Create `automations/actions/run-command.ts`; Test `__tests__/automations/run-command.test.ts`.
- [ ] A1 contract: chips in the script AND the cwd are never spliced into shell text. Each distinct chip becomes child env var `MF_0, MF_1, …`; the compiled script substitutes a quoted `"$MF_<n>"` at each chip site; only author-typed literal text is shell source. The run_action executor passes chips to this action unrendered (or as `{literals, chipEnv}`) — unlike other actions whose ChipText is pre-rendered to strings in Task 8.
- [ ] Tests: multiline script runs via `execFile('/bin/zsh', ['-lc', compiledScript], {cwd, env: {...process.env, ...chipEnv}, signal, maxBuffer: 8MB})` (array args — repo rule; `sh -lc` fallback where zsh absent); a chip valued `"; touch /tmp/mf_pwned; "` produces NO file (assert `existsSync` false) and the literal string reaches the script via `$MF_n`; `outputAs:'lines'` splits trimmed stdout to a list; non-zero exit → failed outcome with stderr tail in error; outputs `output`, `exit_code`; cwd chip resolves via `$MF_n` + `~` expansion.
- [ ] Implement + verify + commit.

### Task 13: files + http ports
**Files:** Create `automations/actions/files.ts` (append/write/read from v1 `connectors/files.ts`; read gains `outputAs` text|lines; outputs `content`/`path`), `automations/actions/http.ts` (from v1 `connectors/http.ts`; outputs `status`, `body`); Test `__tests__/automations/builtin-actions.test.ts`.
- [ ] Verify + commit.

### Task 14: Credentials store
**Files:** Create `automations/credentials.ts` (copy `FileCredentialStore` from `workflows/credentials.ts` verbatim, path `<dataDir>/automation-credentials.json`); Test `__tests__/automations/credentials.test.ts` (adapt v1 patterns: 0600 perms, unreadable file → empty, labels never values).
- [ ] Verify + commit.

### Task 15: Curated connectors
**Files:** Create `automations/actions/github.ts` (`github.create_pr`: repo, title ChipText, body ChipText, head, base → outputs `pr_url`, `pr_number`; `github.list_prs`: author=@me → output `prs` list with item fields `url,title,number,author`; fetch api.github.com, Bearer token cred), `automations/actions/notion.ts` (`notion.add_row`: databaseId + properties record → `page_url`; POST /v1/pages), `automations/actions/ado.ts` (`ado.create_item`: org, project, type, title, description → `work_item_id`, `url`; PAT basic auth, JSON-patch body); Test `__tests__/automations/curated-actions.test.ts` with mocked `fetch` (assert request shape + output mapping + HTTP error → failed outcome).
- [ ] Verify + commit.

## Phase 4 — MCP direct tool calls

### Task 16: Server discovery
**Files:** Modify `packages/core/package.json` (add `@modelcontextprotocol/sdk`); Create `automations/actions/mcp/config.ts`; Test `__tests__/automations/mcp-config.test.ts` with tmp-dir fixture files.
- [ ] Tests: merges `<project>/.mcp.json` + `~/.claude.json` `mcpServers` (project wins on name clash); keeps only stdio entries (`command` present); malformed file → logged skip, never throws.
- [ ] Verify + commit.

### Task 17: Client + catalog + invocation
**Files:** Create `automations/actions/mcp/client.ts` (stdio `Client` per server: `listTools()` with 10s timeout + 5min cache, `callTool(name, args)` with 60s timeout, idle shutdown), `automations/actions/mcp/catalog.ts` (tools → `ActionCatalogEntry` id `mcp:<server>:<tool>`, `paramsSchema` = tool inputSchema passthrough, single output `result` text); Test `__tests__/automations/mcp-client.test.ts` against a fixture Node script speaking MCP stdio (echo tool).
- [ ] Tests: catalog lists fixture tool; invocation substitutes ChipText params then calls; unreachable server → catalog skip + runtime failed outcome.
- [ ] Verify + commit.

## Phase 5 — Interactive verbs

### Task 18: ask_me
**Files:** Create `automations/verbs/ask-me.ts` (executor: create interaction w/ rendered title, emit `automation.interaction.created`, return wait; `InteractionService.respond`: validate against fields incl. `showWhen` — port `validateForm` from v1 `interactions.ts:9` — claim, write field outputs into checkpoint, emit resolved, advance) ; Test `__tests__/automations/ask-me.test.ts`.
- [ ] Tests: pause → respond → answers become per-field tokens; double-respond → "already answered"; respond after run-cancel (interaction `cancelled`) → rejected; invalid choice rejected; `showWhen`-hidden field skipped; pending interaction re-entry keeps waiting. No timeout policy in v2 (spec: "answerable hours later") — interactions never expire; `listDue`/expiry path intentionally absent.
- [ ] Verify + commit.

### Task 19: ask_agent
**Files:** Create `automations/verbs/ask-agent.ts` (executor: render prompt ChipText, `AgentChatPort.createChatAndSend` — reuse `makeChatManagerPort` shape from v1 `agent-port.ts:28` including worktree branchName + default-project fallback; register wait; outputs `result`, `chat_id`, `worktree_path?`), `automations/verbs/agent-waits.ts` (port v1 `agent-waits.ts` onto `agent_waits(chat_id, run_id, step_ref)` in automations.db; `onChatFinished` writes outputs + advances; `recordAssistantText` accumulation); Test `__tests__/automations/ask-agent.test.ts`.
- [ ] Tests: chat created once (scratch chatId guards re-entry); completed → `result` = accumulated assistant text; error/interrupted → step failed (keepGoing honored); timeoutMinutes → wakeAt set. Structured-output enforcement (`expects`) is added in Task 19b — this task leaves plain `result`/`chat_id` outputs.
- [ ] Verify + commit.

### Task 19b: ask_agent structured outputs (A2)
**Files:** Create `automations/verbs/expects.ts` (`buildOutputContract(expects): string` — appends an "End with a JSON object: {...}" instruction; `parseAndValidate(text, expects): {ok: true, outputs} | {ok: false, reason}` — extract the last JSON object, check declared keys exist with declared types, coerce number/list/choice(options)); Modify `automations/verbs/ask-agent.ts`, `automations/verbs/agent-waits.ts`; Test `__tests__/automations/ask-agent-expects.test.ts`.
- [ ] Tests: empty/absent `expects` → unchanged behavior (only `result`, `chat_id`); with `expects` → contract appended to the sent prompt; valid final JSON → declared keys become named typed outputs alongside `result`/`chat_id`; mismatch → ONE corrective message sent into the SAME chat (scratch flag `correctionSent` guards a second retry), second mismatch → step fails loudly ("agent did not return the expected JSON: <reason>"); `choice` value outside `options` → mismatch.
- [ ] Implement: `onChatFinished` routes through `parseAndValidate` when the waiting step declares `expects`; corrective retry re-sends into the chat and stays `waiting`.
- [ ] Verify + commit.

### Task 20: notify
**Files:** Create `automations/verbs/notify.ts`; Test `__tests__/automations/notify.test.ts`.
- [ ] Tests: emits `automation.notification` with rendered message + links (runId, chatIds collected from checkpoint agent steps); calls `PushService.sendPush({title: automation name, body, data:{runId}, priority:'default'})` when port provided; push failure logs, never fails the step.
- [ ] Verify + commit.

## Phase 6 — Triggers, service, wiring

### Task 21: Schedule compile + scheduler
**Files:** Create `automations/triggers/schedule.ts` (`compileSchedule(pattern): cron string` — daily→`M H * * *`, weekdays→`M H * * 1-5`, weekly→day list, every_n_hours→`0 */n * * *`), `automations/triggers/scheduler.ts` (adapt v1 `CronScheduler` to `trigger_state(automation_id, trigger_id)`, **local tz** — drop `tz:'UTC'` from `nextAfter`); Tests `__tests__/automations/schedule-compile.test.ts`, `scheduler.test.ts` (missed+`skip` drops, missed+`run_once` fires exactly once — port v1 `triggers.test.ts` cases).
- [ ] Verify + commit.

### Task 22: Event triggers + chaining, webhook verify
**Files:** Create `automations/triggers/events.ts` (bindings: `session.finished` ← `chat.updated` with terminal reason (excluding automation-owned chats' own waits double-fire — filter chats registered in agent_waits); `automation.finished|failed` ← `automation.completed` with status + optional `automationId` filter; trigger tokens: `result`, `chat_id`), `automations/triggers/webhook.ts` (`verifySignature(secret, rawBody, header)` via HMAC-SHA256 + `crypto.timingSafeEqual`; accepts `X-Signature` and GitHub `X-Hub-Signature-256`; the per-hook secret is read from the credential store under reserved label `webhook:<hookId>` — created there when the trigger is armed; `captureSample` stores last payload in `trigger_state.last_payload`); Test `__tests__/automations/triggers-events.test.ts`, `webhook-verify.test.ts`.
- [ ] Verify + commit.

### Task 23: AutomationService + reconciler + daemon wiring
**Files:** Create `automations/service.ts` (mirror `workflows/index.ts` shape: owns db/stores/registry(+builtins+curated+MCP catalog)/credentials/interpreter/scheduler/interaction+wait services; builds the real `runAction` VerbPort — renders each ChipText param to a string EXCEPT `run_command`, which receives raw chips so Task 12's A1 env-injection applies; CRUD `create/update` runs `AutomationDefinitionSchema` + `validateScopes` and re-arms triggers; arming a webhook trigger generates + stores its `webhook:<hookId>` secret; `setEnabled` arms/disarms; `runManually`; `onDaemonEvent`; 30s sweep — scheduler + wakeAt deadlines; `emitCompletionEvent` → `automation.completed` for BOTH succeeded and failed), `automations/reconciler.ts` (port v1 `reconciler.ts`: re-advance `running`; waiting agent steps without `agent_waits` row → failed + advance — v2 has no `ambiguous` status, keepGoing decides); Modify `packages/core/src/index.ts` (construct `AutomationService` beside `WorkflowService` L114-120, add to `broadcastEvent` closure L196-199, `start()` after L203, `stop()` at shutdown); Tests `__tests__/automations/service.test.ts`, `reconciler.test.ts`.
- [ ] Tests: create→invalid definition rejected with scope errors; schedule fire starts run; chaining automation.completed triggers dependent automation; boot reconcile resumes.
- [ ] Verify + commit. Daemon boots with both engines: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/automations/ src/__tests__/workflows/` both green.

## Phase 7 — Routes + WS

### Task 24: CRUD + runs routes
**Files:** Create `packages/core/src/server/routes/automations.ts` (`GET/POST /api/automations`, `GET/PUT/DELETE /api/automations/:id`, `POST /:id/runs` (202), `GET /:id/runs`, `GET /api/automation-runs/:id` → `{run, timeline}` (timeline projected from checkpoint + definition, output previews display-truncated at 32KB like v1 `workflows.ts:20`), `POST /api/automation-runs/:id/cancel`; bodies validated with `AutomationDefinitionSchema` + name/scope zod; scope validation errors → 400 `{errors}`); Modify `server/routes/types.ts` (add `automations?: AutomationService`), `server/http.ts` (thread + `app.use(automationRoutes(ctx))`), `server/routes/index.ts` (export); Test `server/routes/__tests__/automations-routes.test.ts` (mirror v1 `routes.test.ts` harness).
- [ ] Verify + commit.

### Task 25: Admin + webhook routes
**Files:** Create `server/routes/automation-admin.ts` (`GET /api/automation-interactions`, `POST /api/automation-interactions/:id/respond` (409 on already-answered), `GET /api/automation-actions` (catalog incl. MCP; MCP discovery failures degrade to builtins+curated), credentials per Decision 6 with `^[a-zA-Z0-9_-]+$` label), `server/routes/automation-webhook.ts` (`POST /api/automation-webhooks/:hookId`: lookup trigger by hookId, load secret from credential label `webhook:<hookId>`, verify signature, capture sample, start run with payload tokens; 404 unknown, 401 bad signature); Modify `server/middleware/auth.ts` (L25 area: `req.path.startsWith('/api/automation-webhooks/') → next()`); Tests `automation-admin-routes.test.ts`, `automation-webhook-route.test.ts` (valid sig w/o Bearer token succeeds; invalid sig 401; other routes still require auth).
- [ ] Verify + commit. WS events need no new plumbing (`emitEvent` → `broadcastEvent` → `WebSocketManager.broadcastEvent`).

## Phase 8 — Conformance (spec §12)

### Task 26: Reference automations 1-3
**Files:** Test `__tests__/automations/conformance-basic.test.ts` (loads JSON fixtures via `loadFixture` from Task 4). Fake registry (records calls), fake agent port, real interpreter+stores on tmp DB.
- [ ] Daily health log: schedule daily 21:00; ask_me 4 fields (symptoms multi + "other" showWhen text) → respond → notion.add_row receives ⟨Today⟩+answers → files.append templated. Daily standup: skip-missed schedule; ask_agent `/pending-work` → notify links chat. PR auto-review: webhook-preset trigger with PR payload → ask_agent prompt contains ⟨PR URL⟩ via `field` path.
- [ ] Verify + commit.

### Task 27: Reference automations 4-6
**Files:** Test `__tests__/automations/conformance-blocks.test.ts` (loads JSON fixtures via `loadFixture`).
- [ ] Morning PR sweep: github.list_prs (fake list of 3) → repeat spawns 3 agent chats with ⟨Current PR → URL⟩. Ship work: manual; ask_me choice; If ⟨action⟩ is `create new` → ado.create_item → github.create_pr body contains `AB#⟨Work item ID⟩` in then-branch and works via otherwise too (token → `''`); trailing ask_agent. Daily feature spike (exercises A1+A2+A3): a run_command chip-with-hostile-value produces no side effect (A1); ask_agent declares `expects:[{key:'scope',type:'choice',options:['xs','s','m']}]` and the fake returns JSON → typed `scope` output; a following If gates on `scope is_one_of ['xs','s']` (A3); worktree + autoApprove + timeout options pass through to port.
- [ ] Verify + commit. Phase gate: full `vitest run src/__tests__/automations/` + `tsc --noEmit`.

## Phase 9 — Delete v1 (atomic break point; core + shared types)

> **Sequencing:** runs AFTER the UI plan's Phase 6 entry swap (contract §7) — the app never ships without a workflows screen. The UI plan's Phase 7 owns removing the v1 UI (`packages/ui/features/workflows/`, `lib/api/workflows.ts`, AppShell/SidebarHeader edits) and the e2e specs (`workflows.spec.ts`, `sidebar-chrome.spec.ts` assertions); this plan deletes only core and the shared types. The earlier "ships without a workflows screen" fallback is superseded now that the UI plan exists.

### Task 28: Core deletion
**Files:** Delete `packages/core/src/workflows/` entirely (34 files: `index.ts, db.ts, loader.ts, reconciler.ts, writer.ts, interactions.ts, agent-port.ts, agent-waits.ts, credentials.ts, dsl/{parse,schema,types,verify}.ts, engine/{engine,blocks,scope,failure,types}.ts, engine/executors/{agent,call,connector,question}.ts, connectors/{bash,files,http,registry,types}.ts, template/render.ts, triggers/{events,scheduler}.ts, store/{run-store,interaction-store,types}.ts, projection/run-tree.ts`); Delete `server/routes/workflows.ts`, `server/routes/workflow-admin.ts`; Delete all 22 tests in `packages/core/src/__tests__/workflows/`; Modify `server/http.ts` (drop imports L30/33/44, `workflows` dep L60/76, mounts L154-155), `server/routes/types.ts` (drop L9 import + L22 field), `server/routes/index.ts` (drop L21), `packages/core/src/index.ts` (drop L32-33, L114-120, L177, L198, L201-203, L249 — keep the AutomationService wiring added in Task 23); Modify `packages/core/package.json` (remove `jsonata`, `yaml`; keep `cron-parser`).
- [ ] Verify: `pnpm --filter @qlan-ro/mainframe-core build && pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit && pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/automations/`; `grep -rn "workflows/" packages/core/src` → no hits. Commit.

### Task 29: Shared types deletion
**Files:** Delete `packages/types/src/workflow.ts`; Modify `packages/types/src/index.ts` (drop export), `packages/types/src/events.ts` (drop `workflow.*` variants L89-97). The v1 UI (`packages/ui/features/workflows/`, `lib/api/workflows.ts`, AppShell/SidebarHeader) and the e2e specs are deleted by the UI plan's Phase 7 (contract §7), not here.
- [ ] Verify: `pnpm --filter @qlan-ro/mainframe-types build && pnpm --filter @qlan-ro/mainframe-ui typecheck` (the UI is already on the v2 types by this point — its Phase 6/7 preceded this task); `grep -rn "Workflow" packages/types/src` → only Automation types. Commit.

### Task 30: Docs + changeset
**Files:** Replace `docs/guides/WORKFLOWS.md` with `docs/guides/AUTOMATIONS.md` (model, routes, WS events, action ids, webhook signature format; link the spec); update the CLAUDE.md architecture line only if it mentions workflows (it does not).
- [ ] `pnpm changeset` — `@qlan-ro/mainframe-types`, `@qlan-ro/mainframe-core`, `@qlan-ro/mainframe-ui`, minor: "Replace v1 YAML workflows with Automations v2 (new /api/automations surface; /api/workflows removed)."
- [ ] Final gate: `pnpm build` at repo root; core+ui suites green. Commit.

## Risks / Open Questions (surface to user)

1. **Agent completion detection** reuses v1's `chat.updated` terminal-reason waker — inherits known gaps (CLI death w/ restored permission; see memory `restored-permission-reply-stream-closed`). Acceptable rc risk.
2. **Webhook exposure:** route is auth-exempt by path; reachable externally only via the Cloudflare tunnel. HMAC + timingSafeEqual required; per-hook secret stored under credential label `webhook:<hookId>` (contract §3). Rate limiting NOT included (open question). Related open security findings on WS auth exist (docs/security/) — webhook route must not regress them.
3. **Notify mobile push** uses Expo `PushService` (suppressed when desktop active) — true background delivery depends on device registration; hours-later ask_me answering from mobile also needs the (out-of-scope) mobile UI. Daemon side is complete.
4. **MCP discovery source** (`.mcp.json` + `~/.claude.json`, stdio only) is a unilateral decision; HTTP/SSE servers and OAuth-style MCP auth deferred.
5. **Notion column picking** ("pick database → columns render as fields") needs a database-schema lookup endpoint the fixed REST contract lacks — editor-time concern; `notion.add_row` takes explicit property key/values until then.
6. **Ratified against the contract:** `automation.notification` event (§4) and the webhook route (§5) ARE contract and the Rust plan mirrors them. `trigger_state`/`agent_waits` are NOT contract — engine-internal rebuildable caches; the Rust plan keeps its own derived-state design and both engines ignore unknown tables in the shared file.
7. **run_command "run in worktree"**: v2 exposes `cwd` as a ChipText param; ⟨worktree path⟩ token from a prior ask_agent step covers the spec's worktree option without engine-level worktree state.
8. **v1-YAML import is CUT** (per direction); old `workflows.db`, YAML files, and `workflow-credentials.json` are orphaned, not migrated — credentials must be re-entered once.
