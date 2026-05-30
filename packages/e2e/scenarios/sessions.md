# QA Test Scenarios — Sessions Panel & Session Bar

_Product: Mainframe. Source flows: [`../FLOW-MAP.md`](../FLOW-MAP.md) SP1–SP16. Locators:
`.locator('[data-testid="..."]')`. Existing partial coverage: 02-projects, 04-chat-lifecycle,
21-multi-chat, 35-external-sessions._

**Shared starting conditions:** app launched in Electron, daemon connected. The left ChatsPanel is
visible. Specifics noted per scenario.

---

## Scenario SP1 — Create a session (single project)

**Test Objective:** The new-session button immediately creates a chat when exactly one project exists.

**Test Steps:**
1. With exactly one project, click `chats-new-session` → a new `chat-list-item` appears at the top.

**Expected Outcomes:**
- Button disabled (opacity-40) when 0 projects exist; no popover for the single-project case.

---

## Scenario SP2 — Create a session (multi-project picker)

**Test Objective:** With multiple projects, the picker lets the user choose the target project.

**Test Steps:**
1. With ≥2 projects and no active filter, click `chats-new-session` → `NewSessionPopover` lists projects (active first); each is `chats-new-session-project-{id}`.
2. Click a project → popover closes, chat created in that project.

**Expected Outcomes:**
- With an active project filter, the popover is skipped and a chat is created in the filtered project.
- Click-outside closes the popover with no creation.

---

## Scenario SP3 — Select / switch sessions

**Test Objective:** Clicking a session row activates it and refreshes the session bar.

**Test Steps:**
1. Click a `chat-list-item` → row gets active styling; `session-bar` updates to that chat's adapter/model/branch; CLI resumes.
2. Click a different row → previous deactivates; bar refreshes.

**Expected Outcomes:**
- Clicking row action buttons (tag/rename/archive) does NOT select (stopPropagation).
- Status indicators render: waiting badge, worktree-missing red dot, unread bold title, working spinner.

---

## Scenario SP4 — Filter by project pill

**Test Objective:** Project pills filter the list and persist.

**Test Steps:**
1. With ≥2 projects, click `chats-filter-pill-{name}` → flat view of that project; most-recent chat auto-activates.
2. Click it again (or `chats-filter-pill-All`) → filter cleared, grouped view returns.

**Expected Outcomes:**
- Filter persisted to localStorage (`mf:filterProjectId`).
- Active pill shows an attention-count badge (unread + pending permission).

---

## Scenario SP5 — Filter by tag / clear

**Test Objective:** Tag pills AND-filter the list; clear resets.

**Test Steps:**
1. Click a tag pill in `session-filter-tags` → list narrows to chats with that tag.
2. Click a second tag → narrows further (both tags).
3. When everything is filtered out, click `chats-clear-filters` → all sessions reappear.

**Expected Outcomes:**
- Synthetic `has-pr` / `has-worktree` pills appear only when applicable.
- The filter bar is absent entirely when no tags/worktrees/PRs exist.

---

## Scenario SP6 — Rename a session

**Test Objective:** Inline rename commits on Enter and cancels on Escape.

**Test Steps:**
1. Hover a `chat-list-item`; click the rename button (`chats-session-rename-{id}`) → `chats-session-rename-input-{id}` appears pre-filled, text selected.
2. Type a new name; press Enter → renamed; tab label updates.
3. Re-enter rename; press Escape → original title restored.

**Expected Outcomes:**
- Empty/whitespace title = no-op. Outside-pointerdown commits. Re-sort during edit keeps focus.

---

## Scenario SP7 — Row context menu

**Test Objective:** Right-click exposes Tags/Rename/Pin/Archive/Copy-Session-ID.

**Test Steps:**
1. Right-click a `chat-list-item` → context menu appears.
2. Select Pin → row moves to top (pinned); select Copy Session ID → clipboard gets `claudeSessionId`.

**Expected Outcomes:**
- Right-clicking a project group header shows only "Delete Project".
- Copy Session ID present only when the chat has a `claudeSessionId`.

---

## Scenario SP8 — Archive a session

**Test Objective:** Archiving removes the row, closes its tab, and activates the next chat.

**Test Steps:**
1. Hover a row; click archive (`chats-session-archive-{id}`) → spinner, then row removed, tab closed.
2. For a worktree chat → a confirm asks delete-or-keep worktree first.

**Expected Outcomes:**
- Button disabled during the async op; on failure the chat stays. If it was active, the next most-recent chat in the project activates.

---

## Scenario SP9 — View & restore archived sessions

**Test Objective:** Archived sessions list and restore.

**Test Steps:**
1. Click `archived-sessions-btn` → popover lists `archived-session-item` rows.
2. Click `restore-session-btn` on one → "Restoring…" then it returns to the main list.

**Expected Outcomes:**
- "No archived sessions" empty state; scoped to the active project filter; one restore at a time.

---

## Scenario SP10 — Session bar identity & status

**Test Objective:** The session bar shows adapter/model/branch and the correct live status.

**Test Steps:**
1. Activate a chat → `session-bar` shows adapter dot, model (`session-bar-model`), and `session-bar-branch` if a branch exists; context % bar on the right.
2. Drive the agent → status cycles: Thinking → Awaiting (on permission) → back to idle.

**Expected Outcomes:**
- Status variants: Thinking/Awaiting/Compacting/Starting/Error/Worktree-Missing.
- No active chat → bar renders empty.

---

## Scenario SP11 — Background tasks pill & popover

**Test Objective:** Running background tasks surface in a pill, and can be killed.

**Test Steps:**
1. With ≥1 running bg task, `chat-session-bar-bg-tasks-pill` shows "N task(s)".
2. Click it → `chat-session-bar-bg-tasks-popover` lists tasks with kill buttons; click a kill → task row disappears when it leaves running.

**Expected Outcomes:**
- Pill absent when no running tasks. Recovered-after-restart tasks show a ↻ marker. No outside-click close (toggle via pill only).

---

## Scenario SP12 — Add a project

**Test Objective:** Adding a project opens the directory picker and registers it.

**Test Steps:**
1. Click `chats-add-project` → DirectoryPickerModal opens; pick a dir → project added (new group/pill).

**Expected Outcomes:** Cancel = no project created.

---

## Scenario SP13 — Review changes button (session bar)

**Test Objective:** The review button opens the review modal.

**Test Steps:**
1. With a chat active, click `chat-review-changes-button` (or Cmd+Shift+R) → Review modal opens (see Files/Editor/Review F12).

**Expected Outcomes:** Absent if no chat is found.

---

## Scenario SP14 — PR badges (session bar)

**Test Objective:** Detected PRs render as badges that open externally.

**Test Steps:**
1. Daemon emits `chat.prDetected` → `chat-pr-badges` row appears; click a badge → PR opens in the browser.

**Expected Outcomes:** Absent when no PRs; `created` source takes precedence over `mentioned` for the same PR.

---

## Scenario SP15 — Session row worktree pill (P2)

**Test Objective:** Sessions on a worktree show a pill with the worktree path.

**Test Steps:**
1. For a chat with a `worktreePath`, the row shows `worktree-pill`; hover → tooltip = full path.

---

## Scenario SP16 — Import external session with branch/worktree (P2)

**Test Objective:** External sessions display branch/worktree metadata in the import popover.

**Test Steps:**
1. Open the import popover → external sessions show `external-session-branch` / `external-session-worktree` when metadata exists.
2. Click `import-session-btn` → session imported.

**Expected Outcomes:** Labels shown only when the metadata is present.
