# Plan Mode as an Orthogonal Axis (Multi-Adapter)

**Date:** 2026-04-22
**Status:** Design — awaiting user review before writing-plans
**Scope:** Promote plan mode out of `PermissionMode`, ship Codex plan-mode parity, redesign the settings control, and fix the Thinking-indicator bug after clear-context approve.

## Problem

Three connected issues trace back to the same design mistake: plan mode is modeled as a value inside `PermissionMode`.

1. **Misleading settings UI.** The permission-mode radio in `ProviderSection.tsx` lists Plan alongside Interactive / Auto-Edits / Unattended. Plan is not a permission.
2. **Wrong adapter gate.** PR #232 shipped `adapterSupportsPlanMode(id) => id === 'claude'`, hiding plan mode for Codex. But Codex supports plan mode too — `packages/core/src/plugins/builtin/codex/session.ts:334` already maps `permissionMode === 'plan'` to `collaborationMode.mode = 'plan'`, and Codex's own CLI exposes an exit-plan UX via `requestUserInput`.
3. **Thinking indicator disappears** after approving a plan with Clear Context. The user sees an empty thread and assumes the feature is broken; only after a long delay does content reappear.

## Decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | Split the data model: `Chat.permissionMode: 'default' \| 'acceptEdits' \| 'yolo'` + `Chat.planMode: boolean`. |
| 2 | Full Codex plan-exit parity — detect Codex's `plan` thread item + `requestUserInput` follow-up, route to the existing `PlanApprovalCard`. |
| 3 | Settings: per-adapter "Start in Plan Mode" checkbox, hidden when the adapter doesn't support plan mode. |
| 4 | Adapter capability declaration: add `capabilities.planMode: boolean` to the `AgentAdapter` interface. |
| 5 | Thinking-bug fix: (A) make `kill()` await process exit + (C) session-identity guard on stale `onExit`. |

## Data Model

### Types — `packages/types/src/chat.ts`

Before:
```ts
permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo';
```

After:
```ts
permissionMode?: 'default' | 'acceptEdits' | 'yolo';
planMode?: boolean;
```

### Adapter interface — `packages/types/src/adapter.ts`

```ts
interface AgentAdapter {
  // existing fields...
  readonly capabilities: {
    planMode: boolean;
    // reserved for future capability flags
  };
}
```

- Claude adapter: `capabilities: { planMode: true }`
- Codex adapter: `capabilities: { planMode: true }`
- Gemini / OpenCode: `capabilities: { planMode: false }` (until implemented)

The UI reads capabilities through the existing adapter-metadata path rather than hardcoding. `adapterSupportsPlanMode()` is deleted from `PlanModeToggle.tsx`; the gate becomes `adapter.capabilities.planMode`.

### DB migration

New column on `chats`:
```sql
ALTER TABLE chats ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;
```

One-time up-migration:
```sql
UPDATE chats SET plan_mode = 1, permission_mode = 'default' WHERE permission_mode = 'plan';
```

### Settings keys

- `provider.<adapterId>.defaultMode` — keeps enum `'default' | 'acceptEdits' | 'yolo'`. Migration maps any stored `'plan'` → `'default'` and sets the companion plan-mode default.
- `provider.<adapterId>.defaultPlanMode` — **new** boolean (`'true'` / `'false'` string), read by `lifecycle-manager.createChatWithDefaults` when creating a chat.

## Plan Mode Transport Per Adapter

### Claude (session-level)

- **Spawn flag.** `--permission-mode plan` if `planMode === true`, else `--permission-mode <permissionMode>`.
- **Toggle ON mid-session.** `control_request { subtype: 'set_permission_mode', mode: 'plan' }`.
- **Toggle OFF mid-session.** `control_request { subtype: 'set_permission_mode', mode: <permissionMode> }` — the stored base mode, not a magic `'default'`.
- **Exit UX.** Unchanged. `ExitPlanMode` tool permission already routes through `permission.requested` → `PlanApprovalCard` in `MainframeThread.tsx:49`.

### Codex (per-turn)

- **Every `turn/start`** sends `collaborationMode: { mode: planMode ? 'plan' : 'default', settings: {...} }`.
- **Toggle ON/OFF mid-session.** Update `Chat.planMode` in DB + emit `chat.updated`. No immediate protocol call — the next `turn/start` reads the new value.
- **Plan capture.** `CodexSessionState` gains `currentTurnPlan: { id: string; text: string } | null`. Populated from `item/plan/delta` accumulation, finalized when the `plan` thread item completes, cleared on `turn/started`.
- **Exit-prompt detection.** In `codex/approval-handler.ts` when `item/tool/requestUserInput` arrives:
  - If `chat.planMode === true` AND `currentTurnPlan !== null` → emit a `ControlRequest` with `toolName: 'ExitPlanMode'` and `input: { plan: currentTurnPlan.text, allowedPrompts: [] }`.
  - Otherwise → existing `toolName: 'AskUserQuestion'` path (clarification questions during plan mode still render generically).

Mainframe already routes `ExitPlanMode` to `PlanApprovalCard` via `MainframeThread.tsx:49`, so no UI change is needed for Codex to get the parity treatment.

### Plan-mode-handler dispatch

`packages/core/src/chat/plan-mode-handler.ts` becomes adapter-agnostic. The shared handler dispatches to an adapter-provided `planModeHandler` that knows how to respond in the adapter's own protocol.

`AgentAdapter` gains an optional factory:
```ts
createPlanModeHandler?(chat: Chat, session: AdapterSession | null): PlanModeActionHandler;

interface PlanModeActionHandler {
  onApprove(response: ControlResponse, context: PlanActionContext): Promise<void>;
  onApproveAndClearContext(response: ControlResponse, context: PlanActionContext): Promise<void>;
  onReject(response: ControlResponse, context: PlanActionContext): Promise<void>;
  onRevise(feedback: string, context: PlanActionContext): Promise<void>;
}
```

**ClaudePlanModeHandler** — preserves the current behavior:
- `onApprove` → `setPermissionMode` to the chosen exec mode; clear `planMode` in DB.
- `onApproveAndClearContext` → existing kill-and-replay-plan flow (fixed per Section 5 below).
- `onReject` / `onRevise` → forward the message with Claude's existing preamble.

**CodexPlanModeHandler** — new:
- `onApprove(execMode)`: set `chat.planMode = false`; respond to Codex's `requestUserInput` with the option whose label prefix matches "Yes, implement"; fall back to first option. Update `chat.permissionMode = execMode` so the next turn uses the new policy.
- `onApproveAndClearContext(execMode)`: call `thread/start` to create a fresh thread; send the captured plan text as first user input with `collaborationMode.mode = 'default'`; discard the old thread id (set `chat.codexThreadId = newId`).
- `onReject`: respond with the option whose label prefix matches "No, stay in Plan mode"; fall back to second option.
- `onRevise(feedback)`: respond with free-form answer text (Codex's `requestUserInput` accepts non-option answers).

## Settings UI

`ProviderSection.tsx` changes:

1. The permission-mode radio loses the Plan option — now three items (Interactive / Auto-Edits / Unattended).
2. A `<Checkbox>` labelled **Start in Plan Mode** appears directly below the radio, bound to `provider.<adapterId>.defaultPlanMode`.
3. The checkbox (and its label) is conditionally rendered: `{adapter.capabilities.planMode && <StartInPlanModeCheckbox />}`.
4. Any existing persisted value of `'plan'` on `defaultMode` is rewritten by the migration to `'default'` + `defaultPlanMode='true'` on boot.

## Composer UI

`PlanModeToggle.tsx` — unchanged visually. Capability gate changes:

```diff
- import { adapterSupportsPlanMode } from './PlanModeToggle';
- {adapterSupportsPlanMode(currentAdapter) && <PlanModeToggle ... />}
+ {adapterCapabilities.planMode && <PlanModeToggle ... />}
```

`ComposerCard.tsx`:

- `PERMISSION_MODES` stays at 3 items (already done in PR #232).
- **Delete** `lastNonPlanModeRef` — no longer needed; the base mode lives on `Chat.permissionMode` since plan is orthogonal.
- **Delete** `displayModeForDropdown()` — dropdown always reads `currentMode` directly.
- `handlePlanToggle(enable)` sends the new `planMode` parameter:
  ```ts
  daemonClient.updateChatConfig(chatId, undefined, undefined, undefined, enable);
  ```
- `handleModeChange` no longer saves "last non-plan mode" — it just writes the chosen permission mode.

`updateChatConfig` route signature adds a fifth optional parameter `planMode?: boolean`; the Zod schema on the endpoint accepts it; `chat-manager.updateConfig` writes to the DB and emits `chat.updated`.

**File-size note.** `ComposerCard.tsx` is currently 463 lines (flagged in PR #232 notes). Deleting `lastNonPlanModeRef`, `displayModeForDropdown`, and the related branches nets a small shrink but still leaves it above the 300-line CLAUDE.md guideline. Further decomposition is not in scope; tracked as a separate refactor.

## Thinking-Indicator Bug Fix

Two changes implemented together:

### A) `kill()` awaits process exit

`packages/core/src/plugins/builtin/claude/session.ts`:
```ts
async kill(): Promise<void> {
  const child = this.state.child;
  if (!child) return;
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }
      resolve();
    }, 3000),
  );
  child.kill('SIGTERM');
  await Promise.race([exited, timeout]);
  this.state.child = null;
}
```

The 3-second timeout falls back to SIGKILL so `kill()` never hangs indefinitely. Once the `timeout` branch wins, guard C (below) prevents the lingering `close` event from clobbering the new session's state.

`packages/core/src/plugins/builtin/codex/session.ts`: same pattern, awaiting the `onExit` callback (currently the client close is fire-and-forget). Same 3s timeout.

This makes `plan-mode-handler.ts:handleClearContext` deterministic — by the time `kill()` returns, the old session's `onExit` has already run and `processState` is `null`. The subsequent `startChat()` + `sendMessage()` set it back to `'working'` with no races.

### C) Session-identity guard on `onExit`

`packages/core/src/chat/event-handler.ts` — `buildSessionSink()` captures the session id at sink-construction time:

```ts
function buildSessionSink(
  chatId: string,
  sessionId: string,  // NEW
  // ...
): SessionSink {
  // ...
  return {
    // ...
    onExit(_code) {
      const active = getActiveChat(chatId);
      // Guard: if the chat has already moved to a new session, ignore stale onExit.
      if (active?.session && active.session.id !== sessionId) return;
      // ...existing logic
    },
  };
}
```

`EventHandler.buildSink` threads the session id through. This is belt-and-suspenders — even if `kill()` falls back to SIGKILL or the 5-second timeout path, the old sink can't clobber the new session's state.

## Error Handling

- **Migration failure.** DB migration runs inside the existing `better-sqlite3` migration framework with atomic wrapping; a failure rolls back and the daemon refuses to start, surfacing the error via existing logs. No half-migrated states.
- **Codex `plan` item dropped.** If `item/plan/delta` events arrive but the terminal `plan` item doesn't, `currentTurnPlan` remains non-null at `requestUserInput` time — we still render `PlanApprovalCard` with the partial text. Acceptable; the streamed accumulation is close enough.
- **Codex option-label drift.** Matching is case-insensitive prefix: approve = option starting with `"yes"`, reject = option starting with `"no"`. If neither matches, fall back to positional defaults (first option = approve, second = reject) and log a warning. Plan-exit prompts with other option counts (1 or >2) are logged and routed back to `AskUserQuestionCard` — do not force `PlanApprovalCard` on an unknown shape.
- **No `currentTurnPlan` on `requestUserInput` while in plan mode.** Treat as clarification question; route to `AskUserQuestionCard`. No plan preview shown.
- **Daemon restart mid-plan-exit.** In-memory `currentTurnPlan` is lost on restart. If Codex re-emits the `requestUserInput` on reconnect, we show the fallback `AskUserQuestionCard`. Acceptable edge case; the user can still answer.
- **`currentTurnPlan` lifecycle.** Cleared on `turn/started` AND on `turn/completed`. Prevents a stale plan from turn N leaking into turn N+1 if the exit prompt never arrives.

## Testing

### Core unit tests

- `packages/core/src/__tests__/plan-mode-split.test.ts` — migration converts `permissionMode='plan'` → `planMode=true, permissionMode='default'` on DB load. Settings migration equivalent.
- `packages/core/src/__tests__/plan-mode-handler-codex.test.ts` — Codex plan-exit dispatch: approve → first-option answer + `chat.planMode=false`; approve-with-clear-context → `thread/start` call + plan replay; reject → second-option answer; revise → free-form answer.
- `packages/core/src/__tests__/clear-context-thinking.test.ts` — regression: mock old-session `close` firing after new-session `sendMessage`; assert final `processState === 'working'`, not `null`. Covers both fix paths (A and C) independently.

### Codex adapter tests

- `packages/core/src/plugins/builtin/codex/__tests__/plan-item-capture.test.ts` — `item/plan/delta` accumulation; `plan` item finalization; `currentTurnPlan` cleared on `turn/started`.
- `packages/core/src/plugins/builtin/codex/__tests__/request-user-input-routing.test.ts` — `requestUserInput` before `plan` item → `AskUserQuestion`; after `plan` item with `planMode=true` → `ExitPlanMode`; after `plan` item with `planMode=false` → `AskUserQuestion` (plan captured but toggle already off).

### Desktop tests

- `packages/desktop/src/renderer/components/chat/assistant-ui/composer/__tests__/plan-mode-toggle.test.tsx` — renders for Claude AND Codex; hidden when `adapter.capabilities.planMode === false`.
- `packages/desktop/src/renderer/components/settings/__tests__/plan-mode-checkbox.test.tsx` — writes/reads `provider.<adapterId>.defaultPlanMode`; hidden for unsupported adapters.

### E2E

- `packages/e2e/tests/07-plan-approval.spec.ts` — existing test stays on Claude.
- New `packages/e2e/tests/33-codex-plan-approval.spec.ts` — Codex variant: enter plan mode, exchange, observe `PlanApprovalCard` on Codex's exit prompt, approve, verify next turn is not in plan mode.

## Out of Scope

- Extending plan mode to Gemini / OpenCode adapters (they'll declare `capabilities.planMode: false`).
- Structured Plans panel rendering for Codex `update_plan` / `turn/plan/updated` (tracked TODO in `event-mapper.ts:42`; separate spec).
- Persisting captured Codex plan text across daemon restarts.
- Changing the approve-with-clear-context UX beyond the Thinking-indicator fix.

## Success Criteria

1. A chat started with `provider.claude.defaultPlanMode=true` spawns with `--permission-mode plan`, and `chat.planMode === true` in the DB.
2. A Claude session toggled out of plan mode retains its underlying `permissionMode` (no more magic `'default'` fallback).
3. Codex users see the plan-mode toggle in the composer, can enter plan mode, and receive the `PlanApprovalCard` on the exit prompt with the proposed plan rendered.
4. Approving a Codex plan (without clear-context) sets `planMode=false` and the next turn runs with `collaborationMode.mode='default'`.
5. Approving a plan with Clear Context shows the Thinking indicator within 1s of the user clicking Approve and keeps it visible until the agent's first content arrives — no flicker.
6. Existing chats with `permissionMode='plan'` auto-migrate on first daemon boot; no user intervention required.
7. All existing plan-mode tests pass unchanged; new tests cover the Codex parity path, the migration, and the Thinking-bug regression.
