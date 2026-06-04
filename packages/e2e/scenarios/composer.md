# QA Test Scenarios — Message Composer

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) M1–M12. Locators:
`.locator('[data-testid="..."]')`._

**Shared starting conditions:** app launched in Electron, daemon connected, a project open, a chat
created. The composer (`composer-prompt-input`) is visible.

---

## Scenario M1 — Type and send a message

**Test Objective:** A typed message sends, clears the input, and flips the composer to running state.

**Starting Conditions:** `chat.isRunning === false`, worktree present.

**Test Steps:**
1. Click into `composer-prompt-input`; type text (highlight overlay mirrors it).
2. Click `composer-send` (or press Enter) → message sends; input clears; `composer-stop` appears, `composer-send` hides.

**Expected Outcomes:**
- `composer-send` disabled when input empty **and** no sandbox captures.
- Shift+Enter inserts a newline (no send).
- If `worktreeMissing`, input and send are disabled.
- Captures-only (no text): send routes through send-pending-captures path.

---

## Scenario M2 — Stop a running agent

**Test Objective:** The stop button interrupts a running agent and restores the send button.

**Starting Conditions:** Agent running (`isRunning === true`).

**Test Steps:**
1. Confirm `composer-stop` is shown in place of `composer-send`.
2. Click `composer-stop` → `chat.cancel` sent; agent stops; `composer-send` returns.

**Expected Outcomes:**
- If the agent finishes first, clicking stop is a harmless no-op.

---

## Scenario M3 — Queue a message while running, then edit / cancel it

**Test Objective:** Messages sent while the agent runs are queued and can be edited or cancelled.

**Starting Conditions:** Agent running.

**Test Steps:**
1. Type and press Enter while running → message is queued; `QueuedMessageBanner` shows a row with `composer-queued-edit` and `composer-queued-cancel`.
2. Click `composer-queued-edit` → `composer-queued-edit-input` (autofocused) + `composer-queued-save` appear.
3. Edit text; click `composer-queued-save` (or Enter) → row returns to static with new text.
4. Click `composer-queued-cancel` → row removed immediately (no confirm); banner unmounts if last.

**Expected Outcomes:**
- Save no-ops (but closes editing) if text unchanged or empty.
- Shift+Enter in edit input = newline; Esc cancels edit without saving.

---

## Scenario M4 — Adapter selection locked after first message

**Test Objective:** Adapter can be changed before any message and is locked afterward.

**Test Steps:**
1. On a fresh chat (no messages), click `composer-adapter-select` → options listed.
2. Pick another adapter → label updates; model resets to that adapter's default; plan-mode toggle appears if supported.
3. Send a message, then re-open `composer-adapter-select`.

**Expected Outcomes:**
- After `hasMessages`, `composer-adapter-select` is disabled (opacity 40, no interaction).

---

## Scenario M5 — Model & effort selection

**Test Objective:** Model selection updates config; effort picker appears only for capable models.

**Test Steps:**
1. Click `composer-model-select` → pick a model → label updates.
2. If the model has `supportedEfforts` (non-empty) and the agent is not running,
   `composer-effort-select` is shown with the model's dynamic levels; pick a level → label updates.
3. For an opus-level model the dropdown includes `xhigh` and `max`; for sonnet-level it includes
   `max` but NOT `xhigh` (no `supportsUltracode`); for Haiku the picker is absent entirely.

**Expected Outcomes:**
- `composer-effort-select` hidden for models whose `supportedEfforts` is empty/absent; disabled while running.
- Option set is model-specific — driven by `supportedEfforts`, not a static Low/Medium/High list.
- Model/effort apply on the next turn, not mid-stream.

---

## Scenario M6 — Features popover

**Test Objective:** The features popover surfaces per-model boolean controls; `composer-features-trigger`
is present only when the selected model has at least one tunable feature.

**Test Steps:**
1. Switch to an opus-level model (`supportsUltracode: true`, `supportsAdaptiveThinking: true`,
   `supportsFast: true`) → `composer-features-trigger` appears.
2. Click the trigger → popover opens listing `composer-feature-fast`,
   `composer-feature-ultracode`, `composer-feature-adaptiveThinking`.
3. Toggle `composer-feature-ultracode` ON → the effort chip now shows `Extra-high` and is disabled
   (locked by `displayEffort`'s ultracode coercion). Toggle OFF → chip becomes interactive again.
4. Switch to Haiku (no capability fields) → `composer-features-trigger` is absent.

**Expected Outcomes:**
- Popover closes on outside click.
- Each toggle persists to the chat's `SessionTuning` via the `/api/chats/:id/tuning` endpoint.
- `ultracode` lock is visual only — stored effort is unchanged (resolver coerces at apply time).

---

## Scenario M7 — Permission mode selection

**Test Objective:** Permission mode changes the auto-approval level; `yolo` is visually flagged.

**Test Steps:**
1. Click `composer-permission-mode-select` → pick Interactive / Auto-Edits / Unattended.
2. Pick `yolo` (Unattended) → trigger text turns red (`text-mf-destructive`).

**Expected Outcomes:**
- Config updated via `updateChatConfig`; `default` prompts, `acceptEdits` auto-approves edits, `yolo` auto-approves all.

---

## Scenario M7 — Attach a file & dismiss error

**Test Objective:** Files under the size limit attach; oversize files raise a dismissible error.

**Test Steps:**
1. Click `composer-attach` → pick an image (≤5MB) → it renders in `composer-attachments`; send enables.
2. Attempt a >5MB file → error banner with `composer-dismiss-error` appears.
3. Click `composer-dismiss-error` → banner clears.

**Expected Outcomes:**
- Error text names the file and 5MB limit. Attachments persist into the chat-switch draft.

---

## Scenario M8 — Open the context picker

**Test Objective:** The context picker opens and supports the three entry modes.

**Test Steps:**
1. Click `composer-context-picker` → menu opens above the composer listing agents/skills/commands.
2. Type `@query` → fuzzy agents+files; `@path/` → directory autocomplete; `/partial` → skills/commands.
3. Arrow keys move selection; Enter selects; Esc cleans the token and closes.

**Expected Outcomes:**
- Selecting a file rewrites text to `@path/file ` and closes; selecting a dir keeps the picker open.

---

## Scenario M9 — Enable a worktree (new branch)

**Test Objective:** A new isolated worktree+branch is created and the composer reflects it.

**Starting Conditions:** git project; no active worktree; `worktreeMissing` false.

**Test Steps:**
1. Click `composer-worktree` → popover loads branches+worktrees; defaults to `composer-worktree-tab-new`.
2. Pick a base branch; type a name in `composer-worktree-branch-name` (inline-validated against `^[a-zA-Z0-9][a-zA-Z0-9._/-]*$`, no `..`).
3. Click `composer-worktree-enable` → on success popover closes; `composer-worktree` button turns accent-colored.

**Expected Outcomes:**
- Enable disabled while name invalid/empty.
- Mid-session: an "Session will be paused and resumed in the worktree" warning shows.
- `composer-worktree-cancel` / click-outside closes with no change.

---

## Scenario M10 — Enable a worktree (attach existing)

**Test Objective:** An existing worktree can be attached to the chat.

**Test Steps:**
1. Open `composer-worktree` → click `composer-worktree-tab-existing` → worktrees listed.
2. Click a worktree row → attaches; popover closes; button turns accent.

**Expected Outcomes:**
- "No worktrees found" empty state when none exist; attach buttons disabled while a request is in flight.
