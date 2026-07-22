# QA Test Scenarios — Chat Interactive Cards

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) C1–C11. Generated via the
`test-scenarios` skill. Each scenario is QA-ready and maps to a Playwright spec under
`packages/e2e/tests-tauri/`. Locators: `.locator('[data-testid="..."]')`._

**Shared starting conditions (all scenarios):** app launched in Electron, daemon connected, a
project open, a chat created with a Claude adapter. The composer is visible until a card replaces
it. The session bar status reads "Awaiting" while any card is shown.

---

## Scenario C1 — Tool permission: Allow Once

**Test Objective:** A single-use tool approval is sent to the CLI, the card clears, and no
persistent rule is saved (the same tool prompts again next time).

**Starting Conditions:** Chat in `default` permission mode; CLI emits `can_use_tool` for a tool
other than `AskUserQuestion`/`ExitPlanMode` (e.g. `Bash`); daemon emits `permission.requested`.

**User Role:** Developer driving an agent session.

**Test Steps:**
1. Trigger a tool-permission request → `permission-card` replaces the composer; session bar shows "Awaiting".
2. Click `chat-permission-details-toggle` → a `<pre>` JSON block of `request.input` expands; click again → collapses (pure UI, no response sent).
3. Click `chat-permission-allow-once-button` → card disappears, composer re-renders, status clears.
4. Cause the same tool to be requested again → the permission card appears once more (no saved rule).

**Expected Outcomes:**
- Response sent to CLI is `behavior: 'allow'` with `updatedInput` unchanged and **no** `updatedPermissions`.
- Card unmounts immediately on click; composer returns.
- Identical subsequent tool use prompts again (allow-once does not persist).

---

## Scenario C2 — Tool permission: Deny

**Test Objective:** Denial is sent to the CLI; the turn continues (deny without interrupt does not stop the agent).

**Starting Conditions:** Same as C1.

**Test Steps:**
1. Trigger a tool-permission request → `permission-card` shown.
2. Click `chat-permission-deny-button` → card disappears, composer returns.

**Expected Outcomes:**
- Response sent is `behavior: 'deny'`, no `message` field.
- Agent receives the denied tool block and continues its turn (session does not terminate).

---

## Scenario C3 (edge) — Always Allow conditional rendering

**Test Objective:** The "Always Allow" button renders **only** when the daemon supplies suggestions,
and when used it sends those suggestions verbatim as `updatedPermissions`.

**Test Steps:**
1. Trigger a permission request with **empty** `suggestions` → assert `chat-permission-always-allow-button` is **absent**; allow-once and deny are present.
2. Trigger a permission request with non-empty `suggestions` → assert `chat-permission-always-allow-button` is **present**.
3. Click it → card clears.

**Expected Outcomes:**
- Button absent in state 1, present in state 2.
- Response is `behavior: 'allow'` with `updatedPermissions` equal to `request.suggestions` (unmodified).

---

## Scenario C4 — Plan approval: Approve with execution mode + clear context

**Test Objective:** Approving a plan sends the chosen execution mode and clear-context flag;
`yolo` maps to bypass-permissions; clear-context wipes history and restarts the CLI.

**Starting Conditions:** Chat in plan mode; CLI calls `ExitPlanMode`; daemon emits
`permission.requested` with `toolName === 'ExitPlanMode'` and `request.input.plan` (markdown).

**Test Steps:**
1. Enter plan mode and let the agent present a plan → `plan-approval-card` shown with a scrollable markdown preview; "Awaiting" status.
2. Change `chat-plan-exec-mode-select` to `yolo` → select border/icon turn destructive red.
3. Tick `chat-plan-clear-context-checkbox`.
4. Click `chat-plan-approve-button` → card clears; thread blanks then repopulates (history cleared, new CLI process).

**Expected Outcomes:**
- Response: `behavior: 'allow'`, `executionMode: 'yolo'`, `clearContext: true`.
- `yolo` resumes the session in bypass-permissions (no further tool prompts).
- With clear-context: `messages.cleared` emitted, `claudeSessionId` reset, fresh process started; if `plan` present it is auto-sent as the first message.
- **Variant:** approve with exec-mode `default` and clear-context unchecked → `clearContext` is `undefined` (not `false`); existing CLI executes the plan in place, history retained.

---

## Scenario C5 — Plan approval: Reject

**Test Objective:** Rejecting a plan sends a bare deny; the agent returns control to the composer.

**Test Steps:**
1. Let the agent present a plan → `plan-approval-card` shown.
2. Click `chat-plan-reject-button` → card clears.

**Expected Outcomes:**
- Response is `behavior: 'deny'` with no `message`.
- Agent acknowledges and the composer returns.

---

## Scenario C6 (edge) — Plan approval: Revise loop

**Test Objective:** Revise reveals a required-feedback textarea; sending feedback denies-with-message
and the agent re-presents a plan; loop repeats until approve/reject.

**Test Steps:**
1. Plan card shown → click `chat-plan-revise-button` → action buttons + exec-mode select hide; `chat-plan-feedback-input` appears (autofocused); `chat-plan-send-feedback-button` is **disabled**.
2. Type feedback → send button enables.
3. Click `chat-plan-send-feedback-button` (or press Cmd/Ctrl+Enter) → card clears; agent revises and a **new** `plan-approval-card` appears.
4. From step 1's state, instead click `chat-plan-cancel-revise-button` → returns to normal state, feedback discarded.

**Expected Outcomes:**
- Send disabled while feedback is empty/whitespace; clicking it is a no-op.
- Sent response: `behavior: 'deny'`, `message: <feedback>`.
- Plain Enter inserts a newline (does not send).
- Loop can repeat multiple times.

---

## Scenario C7 — Ask question: Single-select submit

**Test Objective:** A single-select question requires one pick before submit; the answer reaches the CLI.

**Starting Conditions:** Agent calls `AskUserQuestion` with one question, `multiSelect: false`.

**Test Steps:**
1. Trigger the question → `ask-question-card` shown; each option renders as `chat-question-option-<label>` (role=radio); `chat-question-option-other` always present; `chat-question-submit-button` **disabled**.
2. Click an option → it gets selected styling, `aria-checked="true"`; submit enables.
3. Click another option → selection moves (single-select replaces).
4. Click `chat-question-submit-button` → card clears.

**Expected Outcomes:**
- Submit disabled until exactly one option chosen.
- Response: `behavior: 'allow'`, `updatedInput.answers = { [question]: '<label>' }`.

---

## Scenario C8 (edge) — Ask question: "Other" free-text & empty-other

**Test Objective:** Selecting "Other" reveals a text input; an empty "Other" is filtered out of the answer.

**Test Steps:**
1. Question shown → click `chat-question-option-other` → `chat-question-other-input` appears (autofocused); submit enables.
2. Submit with the input **empty** → answer for that question is `''` (single) / `[]` (multi) after `filter(Boolean)`.
3. Re-trigger; click Other, type text, submit → answer equals the typed text.
4. Click Other again to deselect → input hides; if it was the only selection, submit re-disables.

**Expected Outcomes:**
- Empty "Other" produces an empty answer, not the literal "Other".
- Typed "Other" text is used verbatim.

---

## Scenario C9 (edge) — Ask question: Skip & multi-question navigation

**Test Objective:** Skip sends a bare deny at any time; multi-question nav preserves selections and
swaps Next↔Submit correctly.

**Test Steps (skip):**
1. Question shown → click `chat-question-skip-button` (with or without a selection) → card clears.
   - Expected: `behavior: 'deny'`; no answers sent.

**Test Steps (navigation, questions.length === 3):**
1. Q1 shown → `chat-question-back-button` **absent**; `chat-question-next-button` present but disabled; counter "Question 1 of 3".
2. Select an option → Next enables; click Next → Q2; Back now appears.
3. Select Q2 option → Next → Q3; `chat-question-submit-button` replaces Next (last question).
4. Click Back → Q2 with previous selection still checked; Next enabled immediately.
5. Forward to Q3, select, click Submit → card clears.

**Expected Outcomes:**
- Back absent only on Q1; Next and Submit never both rendered.
- Selections persist across back/forward (stored per-question).
- Final answer object contains an entry for every question, not just the visible one.

---

## Cross-cutting: watchdog re-display (applies to all)

**Test Objective:** If a response is lost, the card reappears.

**Test Steps:** Respond to any card, then simulate the daemon still holding the same `requestId`
after 3s → the same card reappears.

**Expected Outcome:** The card is re-shown for the unresolved `requestId` (optimistic clear is reverted).
