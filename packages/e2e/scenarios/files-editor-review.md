# QA Test Scenarios — Files / Editor / Review

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) F1–F12. Locators:
`.locator('[data-testid="..."]')`. Existing 12-changes-tab & 14-editor reference dead selectors —
correct replacements noted in [`../COVERAGE-GAP-REPORT.md`](../COVERAGE-GAP-REPORT.md)._

**Shared starting conditions:** app launched, daemon connected, a project active. Panel widths must
exceed the responsive thresholds noted per scenario.

---

## Scenario F1 — Browse & refresh the files panel

**Test Objective:** The files tree loads, expands the root, and refreshes on demand.

**Test Steps:**
1. Click `zone-tab-files` → FilesTab mounts; root collapsed.
2. Click `files-root-toggle` → root expands; `files-tree-node-{path}` children appear.
3. Click `files-refresh` → tree reloads.

**Expected Outcomes:**
- `files-refresh` is hidden below 160px panel width — widen the panel first.
- No project → "No project selected" (no interactive elements). Auto-refreshes on `context.updated` and window focus.

---

## Scenario F2 — Expand a directory / open a file

**Test Steps:**
1. With root expanded, click a directory `files-tree-node-{path}` → toggles, loads children.
2. Click a file node → opens it in the editor (`openEditorTab`).

**Expected Outcomes:** Right-click opens a native context menu (Find in Path, etc.).

---

## Scenario F3 — File-view navigation (next/prev change, reveal, collapse)

**Test Objective:** Diff navigation controls scroll hunks, reveal in tree, and collapse the view.

**Starting Conditions:** a diff with >1 hunk is open, file view not collapsed.

**Test Steps:**
1. Click `fileview-next-change` → scrolls to next hunk; `fileview-prev-change` → previous.
2. Click `fileview-reveal-in-tree` → the file scrolls into view in the Files tree.
3. Click `fileview-collapse` → file view collapses to the narrow rail.

**Expected Outcomes:**
- next/prev present only when `diffChangeCount > 1`; reveal present only when `filePath` is set.
- `FileViewHeader` returns null (no buttons) when no file is open.

---

## Scenario F4 — Expand a collapsed file view

**Test Steps:**
1. With a file open and the view collapsed, click `layout-expand-file-view` → full file view returns.

**Expected Outcomes:** The expand rail is absent when no file is open.

---

## Scenario F5 — Changes tab: refresh & mode switch

**Test Objective:** The Changes tab refreshes and switches between session/uncommitted/branch modes.

**Test Steps:**
1. Click `zone-tab-changes` → list loads.
2. Click `changes-refresh` → reloads (disabled in session mode with no active chat).
3. Open `zone-button-tab-dropdown` → pick a mode (`zone-tab-dropdown-option-{session|uncommitted|branch}`) → list switches.
4. Click a file (`changes-{session|uncommitted|branch}-file-{path}`) → opens the diff.

**Expected Outcomes:** Mode tabs are a dropdown, not role="tab" buttons.

---

## Scenario F6 — Find in path modal

**Test Objective:** Searching within a directory scope returns grouped results and opens them.

**Test Steps:**
1. Right-click a directory node → "Find in Path…" → `find-in-path-modal` opens; `find-in-path-input` focused.
2. Type ≥2 chars → after 300ms debounce, results group by file.
3. Check `find-in-path-include-ignored` (dir scope only) → re-runs including ignored files.
4. Arrow-navigate and Enter (or click a result) → opens the file at line; modal closes.
5. Click `find-in-path-close` / Esc / backdrop → closes.

**Expected Outcomes:** include-ignored absent for file scope. Results capped at 200 ("limit reached"). Debounced searches abort prior in-flight.

---

## Scenario F7 — Add an inline comment & send

**Test Objective:** A glyph-margin comment widget collects text and sends it to the composer.

**Starting Conditions:** an editor/diff is open with `onLineComment` (glyph margin enabled).

**Test Steps:**
1. Click the glyph-margin icon on a line → `line-comment-widget` opens; `editor-inline-comment-input` focused.
2. Type text → `editor-inline-comment-send` enables; click (or Enter) → comment formatted and sent; widget removed.
3. Alternatively click `editor-inline-comment-cancel` (or Esc) → widget closes without sending.

**Expected Outcomes:** Send disabled while empty. Shift+Enter = newline. Multiple widgets can coexist. (Note: `LineCommentPopover` / `editor-line-comment-*` is dormant — do not test.)

---

## Scenario F8 — Submit review (batch)

**Test Objective:** All pending inline comments submit as one review.

**Test Steps:**
1. With ≥1 non-empty comment widget, `editor-submit-review` shows "Submit review (N)".
2. Click it → all non-empty comments sent as one message; all widgets close.

**Expected Outcomes:** Disabled when all widgets are empty. Empty comments are filtered out before sending.

---

## Scenario F9 — Save an edited file

**Test Steps:**
1. Edit a real file → `center-button-save` appears (dirty).
2. Click it (or Cmd+S) → saves; button shows "Saving…" then disappears; dirty clears.

**Expected Outcomes:** No-op for external/null-path files.

---

## Scenario F10 — Disk-change banner (keep mine / reload)

**Test Objective:** A concurrent disk change while dirty offers reload-or-keep.

**Test Steps:**
1. With unsaved edits, daemon emits `file:changed` → yellow banner with `center-button-reload-from-disk` and `center-button-keep-mine`.
2. Click reload → disk version loaded, edits lost. OR click keep-mine → banner dismisses, edits preserved.

**Expected Outcomes:** `file:changed` while not dirty → silent auto-reload (no banner). Deleted on disk → "File deleted or moved".

---

## Scenario F11 — Directory picker

**Test Objective:** Browsing, selecting, and dismissing the directory picker.

**Test Steps:**
1. Picker open → `dir-picker-modal`; entries are `dir-entry-{path}`.
2. Click a directory entry → selected + expands children; click `dir-picker-select-btn` → `onSelect`, closes.
3. Click `directory-picker-cancel` / `directory-picker-close` / Esc / backdrop → cancels.

**Expected Outcomes:** cancel == close. Select disabled until a valid selection (mode-dependent: directory vs file).

---

## Scenario F12 — Review changes modal

**Test Objective:** The review modal shows the chat's git changes with a file tree + diff.

**Starting Conditions:** a chat with a `projectId`.

**Test Steps:**
1. Open via `chat-review-changes-button` (SP13) or Cmd+Shift+R → `review-modal` opens; FileTree populates; first file auto-selected; DiffView renders.
2. Toggle `review-button-mode-inline` / `review-button-mode-side-by-side` (only when a file is selected).
3. Click `review-button-close` → modal closes.

**Expected Outcomes:**
- **No backdrop/Esc close** (unlike other modals) — close only via the button.
- Non-worktree chat shows an "changes are not isolated" warning. No changes → "No changes to review".
