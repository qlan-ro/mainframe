# QA Test Scenarios — Todos / Tasks Panel

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) T1–T8. Locators:
`.locator('[data-testid="..."]')`. The existing `19-todos.spec.ts` targets the removed kanban
board (`todo-column-*`, `todos-panel-icon`) and must be rewritten against these flows._

**Shared starting conditions:** app launched in Electron, daemon connected, a project active so
the Todos panel/plugin is available.

---

## Scenario T1 — Quick-create a task

**Test Objective:** A task is created from the global quick-create dialog and appears in the board.

**Starting Conditions:** Todos plugin registered the `quick-create` action (the dialog is opened via
`usePluginLayoutStore.triggerAction('todos','quick-create')` / its keyboard shortcut — **not** a
panel button).

**User Role:** Developer capturing a task.

**Test Steps:**
1. Trigger quick-create → `todos-quick-dialog` opens; `todos-quick-title-input` autofocused; `todos-quick-create` disabled.
2. Type a title → create button enables.
3. (Optional) type body in `todos-quick-body-input`; add a label via `todos-label-input` (Enter/Tab to commit).
4. Click `todos-quick-create` (or Cmd/Ctrl+Enter) → toast "Task #N created", dialog closes, new card appears in the Open column.

**Expected Outcomes:**
- Create disabled until title non-empty.
- With no active project → "No active project" toast, dialog stays open.
- Esc / backdrop click closes with no API call.
- Pasted image (≤10MB, image/* only) shows a thumbnail; non-image paste ignored.

---

## Scenario T2 — Create a task via the full modal

**Test Objective:** The full "New Task" modal creates a task with all fields and optional attachment.

**Test Steps:**
1. Click `todos-new` → `todos-modal-dialog` opens titled "New Task"; `todos-modal-title-input` autofocused.
2. Fill title; set `todos-modal-type-select`, `-priority-select`, `-status-select`; type `-body-input`.
3. (Optional) click `todos-modal-upload` → `todos-modal-file-input` opens picker → choose image (≤10MB) → preview appears.
4. Add `todos-modal-assignees-input` (comma-separated) and `todos-modal-milestone-input`.
5. Click `todos-modal-save` → modal closes, card appears in the column matching chosen status.

**Expected Outcomes:**
- `todos-modal-save` disabled until title set.
- **`todos-modal-upload`/`-file-input` exist only in create mode** (edit mode uses `todos-attachments-*`).
- On API failure the modal stays open (error logged only).

---

## Scenario T3 — Edit an existing task

**Test Objective:** Editing pre-populates the modal and persists changes; cancel/close discard.

**Test Steps:**
1. Click a `todo-card` (or its edit pencil) → `todos-modal-dialog` opens titled "Edit Task", fields pre-filled.
2. Change any field; manage attachments via `todos-attachments-upload` → `todos-attachments-file-input`.
3. Click `todos-modal-save` → card updates in place.
4. Re-open; click `todos-modal-cancel` (or `todos-modal-close`, or Esc) → modal closes, no change.

**Expected Outcomes:**
- Edit mode shows `TodoAttachments` (immediate upload) instead of the create-mode pending-files UI.
- `todos-modal-cancel` and `todos-modal-close` behave identically.

---

## Scenario T4 — Attach images to an existing task

**Test Objective:** Images upload, preview, open in lightbox, and delete.

**Test Steps:**
1. Open a todo in edit mode → click `todos-attachments-upload` → `todos-attachments-file-input` opens → choose image.
2. Upload completes → thumbnail appears (button shows "Uploading..." while in flight).
3. Click thumbnail → ImageLightbox opens over the modal. Hover + delete removes it.

**Expected Outcomes:**
- Accepts only .jpg/.jpeg/.png/.gif/.webp; **>10MB silently skipped** (no error shown).
- Upload button disabled while uploading.

---

## Scenario T5 — Set task dependencies

**Test Objective:** Dependencies are added/removed via the picker and persisted on save.

**Starting Conditions:** Modal open; ≥1 other todo exists.

**Test Steps:**
1. Click `todos-dep-add-toggle` → dropdown opens; `todos-dep-search` autofocused; up to 5 todos listed.
2. Type to filter; click an option → chip appears, option removed from list.
3. Click a chip's remove → todo returns to the dropdown. Save → `dependencies` array persisted.

**Expected Outcomes:**
- `todos-dep-add-toggle` hidden when no candidate todos remain.
- Click-outside / Esc closes dropdown and clears search.

---

## Scenario T6 — Filter the board

**Test Objective:** Type/priority/label/text filters narrow the board and clear correctly.

**Test Steps:**
1. Type in `todos-filter-search` → cards filter live by title; `todos-filter-search-clear` appears.
2. Click `todos-filter-search-clear` → search resets.
3. (If a label exists) click `todos-filter-labels-toggle` → choose a label → board filters.
4. With any filter active, click `todos-filter-clear` → all filters reset, all cards visible.

**Expected Outcomes:**
- `todos-filter-labels-toggle` renders only when ≥1 todo has a label.
- `todos-filter-clear` renders only when a filter is active.
- Text search matches title only (case-insensitive). Filter state persists within the session.

---

## Scenario T7 — Start an agent session from an in-progress task

**Test Objective:** Starting a session from the modal queues the task's initial message and switches to the chat view.

**Starting Conditions:** Target todo has `status === 'in_progress'`; modal open in edit mode for it.

**Test Steps:**
1. Confirm `todos-modal-start-session` is visible (footer, left).
2. Click it → modal closes; attachments are pulled into the composer; a session starts and the UI switches to fullview/chat with the task description pre-populated.

**Expected Outcomes:**
- Button **absent** unless status is `in_progress` (never in create mode, never on open/done).
- A new chat is created/subscribed and the initial message queued.

---

## Scenario T8 — Load failure and retry

**Test Objective:** A failed load shows an error with a working manual retry.

**Test Steps:**
1. With the daemon down / API failing, mount the panel → error "Failed to load tasks. Is the daemon running?" + `todos-retry`; board not rendered.
2. Restore the daemon; click `todos-retry` → board loads.

**Expected Outcomes:**
- Manual retry only (no auto-retry); error and spinner never show simultaneously.
