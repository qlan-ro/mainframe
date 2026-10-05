/**
 * §session-panel — the session panel: ONE scrolling column of sections
 * (Session · Pull requests · Context · Activity · Tasks · Launch · Plan),
 * docked beside the transcript or floated over it.
 *
 * Rewritten whole for the shell redesign (docs/plans/2026-10-04-mainframe-redesign-adoption.md
 * D20/D21): the floating RAIL (`SessionPanelRail`/`SessionRailButton`) and its
 * per-card toggle/dot/close are ALL gone. There is no more stack of
 * independently-opened cards — every section renders together, in one column,
 * and the title bar's `title-bar-details` toggle is the panel's ONLY switch.
 * Scenarios are retargeted, not deleted, except where the capability itself
 * (a per-card open/close, a per-card live dot, the rail's own context meter)
 * no longer exists — those are called out and dropped at the point they used
 * to live, with a reason.
 *
 * Source read: packages/ui/src/features/session-panel/{SessionPanel,SessionPanelToggle,
 * panel-mode,panel-control-store,use-session-panel-state,SummarySection,PullRequestsSection,
 * ContextSection,ActivitySection,TasksSection,LaunchSection,PlanSection,AgentPlan,
 * PanelEyebrow,PanelSection,ContextFileItem,PanelAttachmentsGrid,summary-view,plan-view,
 * launch-view,context-groups,derive-session-items}.tsx,
 * packages/ui/src/store/{ui-prefs,session-todos}.ts,
 * packages/ui/src/features/sessions/new-thread/ChatSurface.tsx,
 * packages/core-rs/crates/mainframe-adapter-mock/src/session_trait.rs.
 *
 * ── Docking, not a rail-and-stack ─────────────────────────────────────────────
 * `panel-mode.ts`: `derivePanelMode({columnWidth, open, overlayOpen})` →
 * `'inline' | 'overlay' | 'hidden'`. `INLINE_MIN_WIDTH = 1044` (a 720px capped
 * transcript column + 24px gap + the 300px panel). `open` is ONE persisted bit
 * (`ui-prefs` v8 `sessionPanelOpen`, default `true`) that auto-opens the first
 * time the column fits after boot, even over a persisted close from a previous
 * run (`use-session-panel-state.ts`'s `bootOpened` ref) — so a WIDE viewport
 * docks the panel with no click at all. `overlayOpen` is transient, per chat
 * column (`panel-control-store.ts`), and `title-bar-details`'s click goes
 * through `togglePanel(columnId, fits)`: open-and-fitting → close; open-but-
 * narrow-and-not-floating → float (the click asked to SEE the panel, not to
 * silently close it); anything else → the plain open/close toggle.
 *
 * ── Viewport is explicit here, unlike every other spec ───────────────────────
 * `fixtures/app-tauri.ts` calls `browser.newContext()` with no `viewport`, so the
 * suite runs at Playwright's 1280×720 default — ambiguous for docking, so every
 * describe sets one explicitly: DOCKED (2100 → chat column clears 1044, panel
 * docks with no interaction), OVERLAY (1150 → column is short, panel starts
 * `hidden`, `title-bar-details` floats it), HIDDEN (900 → column fits nothing;
 * proves the toggle itself survives rather than that it floats). Mode is
 * asserted by `session-panel-root`'s `data-mode` attribute and testid presence,
 * never by measuring boxes.
 *
 * ── Ground truth under mock-cli (read before adding assertions) ──────────────
 * Inherited verbatim from the predecessor spec and re-verified against the Rust
 * mock adapter (`mainframe-adapter-mock/src/session_trait.rs`):
 *   - `get_context_files()` returns `ContextFiles::default()` — globalFiles and
 *     projectFiles are ALWAYS empty, seeded CLAUDE.md or not. The Context
 *     section's memory-file sub-group therefore never renders here; its absence
 *     is asserted (with this reason) rather than left unstated.
 *   - `extract_plan_files()` returns `[]` — the Session sub-group's 'plan' badge
 *     is unreachable.
 *   - `extract_skill_files()` returns `[]`, and the Skills sub-group lists the
 *     skills the SESSION INVOKED (`SessionContext.skillFiles`) rather than the
 *     adapter's available-skills catalog. So no skill row is reachable here;
 *     the empty-state row + the Manage link are asserted instead, the same way
 *     the memory-file sub-group's absence is. Seeding `.claude/skills` no longer
 *     affects this panel — `listSkills` feeds the Setup Advisor, not the panel.
 *   - The mock adapter derives `background_task.*` events from replayed tool_use /
 *     tool_result blocks (todo #327's `task_bridge.rs`) rather than emitting them
 *     itself, so most recordings still carry none and Activity reads empty for
 *     them. `task-subagent.0` is the one exception (below) — its Task tool_use
 *     resolves only on a second turn, giving Activity's running state a real,
 *     reachable fixture.
 * The two adapter-independent seeds survive: `POST /api/chats/:id/mentions` and
 * `POST /api/chats/:id/attachments` write straight to the daemon.
 *
 * AGENTS ARE GONE (D15 of the PRECEDING right-sidebar revamp, T5.4): the
 * predecessor spec's agent-row test has no successor — `AgentsList` was removed
 * and no surface lists `AgentConfig`. A deliberate, documented capability loss,
 * not an oversight.
 *
 * The context-window coverage below (Summary's `session-panel-summary-context`)
 * is the successor to the now-deleted `ChatCardHeader`'s context meter (T5.5,
 * then D7 of the shell redesign), which is why this file uses the `chat-status`
 * recording that meter's own spec used.
 *
 * Testid reference (verified against packages/ui/src):
 *   title-bar-details             — the panel's ONE switch (layout/TitleBar.tsx's right
 *                                    cluster); `aria-pressed` mirrors the persisted open bit
 *   session-panel-root[data-mode] — "inline" | "overlay" | "hidden" ("hidden" renders null)
 *   session-panel                 — the INLINE column's own wrapper (docked mode only)
 *   session-panel-overlay         — the FLOATING column's own root (role=dialog), with
 *                                    `session-panel-scrim` behind it
 *   session-panel-sections        — the one scrolling column, present in BOTH modes
 *   session-panel-card-session    — the Session section (SummarySection + the panel's own
 *                                    "Session" eyebrow); always rendered, never closable alone
 *   session-panel-section-prs     — Pull requests section; absent when the session has none
 *   session-panel-section-summary — SummarySection root, inside the Session section
 *                                    (never collapsible → no toggle)
 *   session-panel-section-<plan|context> — the two sections that stayed collapsible
 *                                    (`PanelSection`)
 *   session-panel-section-toggle-<id>  — its header row (the whole width is the
 *                                    trigger); `data-state` reports open/closed
 *   session-panel-summary-branch  — branch row; a BUTTON opening BranchPopover now
 *                                    (see git-branch.spec.ts). -branch-wt is its
 *                                    worktree badge (absent on a main-repo session)
 *   session-panel-summary-context — context-fill row ("42%") — the ONLY context readout
 *                                    left in the panel; there is no separate rail meter any more
 *   session-panel-summary-changes — working-changes row; click emits open-review
 *   session-panel-summary-pr-<number> — a detected-PR row, now inside `session-panel-section-prs`
 *                                    (unseedable in browser mode; see title-bar.spec.ts's
 *                                    identical note)
 *   session-panel-summary-empty   — no rows at all
 *   session-panel-card-activity   — Activity section; ALWAYS rendered once the panel is open
 *                                    (no per-card toggle any more)
 *   session-panel-activity-live   — its eyebrow's live dot (present while anything is running)
 *   session-panel-plan            — PlanSection root (absent when there are no todos)
 *   session-panel-plan-toggle     — AgentPlan header ("{done} of {total}") + collapse trigger
 *   session-panel-plan-progress   — the progress track; its fill carries style="width: N%"
 *   session-panel-plan-step-<i>   — one plan step, keyed by position
 *   session-panel-activity-empty  — "Nothing running"
 *   session-panel-task-<id> / session-panel-workflow-<runKey> — live rows; the
 *                                    `agent`-kind row is covered by the task-subagent
 *                                    describe below, `workflow` stays unreachable
 *                                    (out of scope — see the ground-truth note)
 *   session-panel-card-launch     — Launch section; ALWAYS rendered once the panel is open
 *   session-panel-launch-live     — its eyebrow's live dot (present while any config runs)
 *   session-panel-launch-row-<name>   — a launch config row (whole row acts)
 *   session-panel-launch-start-<name> / -stop-<name> — the row's action glyph (a span
 *                                    INSIDE the row button; both are clickable)
 *   session-panel-launch-empty    — "No Launch Configurations"
 *   session-panel-card-tasks      — Tasks section; ALWAYS rendered once the panel is open
 *   session-panel-tasks-new / -tasks-empty / -tasks-no-project / -task-row-<number>
 *                                  — the Tasks section (its content is tasks.spec.ts's)
 *   session-panel-context-file-<path> — a memory-file row (never rendered under mock-cli)
 *   session-panel-session-item-<path> — a Session sub-group row; click emits open-file
 *   session-panel-skill-<path>    — a Skills sub-group row: a skill THIS session
 *                                    invoked; click opens its SKILL.md (unreachable here)
 *   session-panel-skills-empty / session-panel-skills-manage — its empty state / Manage link
 *   session-panel-attachment-grid / session-panel-attachment-<id> — attachment tiles
 *   image-lightbox-dialog         — ImageLightbox content (opened by an image tile)
 *   review-modal                  — the Review panel the Changes row opens
 *   WORKSPACE.strip                — a workspace pane's tab strip (opened files land here)
 *
 * RETIRED testids (do not re-assert — the floating rail is gone, D20):
 * `session-panel-rail*`, `session-panel-card-close-*` (no per-card close — the
 * whole panel opens/closes together via `title-bar-details`), and every
 * "rail mirrors the card" assertion that went with them (the Launch/Activity
 * live dots moved into their own section eyebrows instead).
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitConnected, waitForIdle } from '../helpers/tauri/wait.js';
import { sessionsSidebar, composer } from '../helpers/tauri/page-objects.js';
import { WORKSPACE } from '../helpers/tauri/testids.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

/** Chat-host width comfortably above / between / below `INLINE_MIN_WIDTH` (1044). */
const DOCKED = { width: 2100, height: 900 };
const OVERLAY = { width: 1150, height: 900 };
const HIDDEN = { width: 900, height: 900 };

// A 1x1 transparent PNG — small enough to round-trip instantly through the
// attachment store, real enough for the grid to render an <img>.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// ── seeds ────────────────────────────────────────────────────────────────────

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitCommit(cwd: string, message: string): void {
  git(cwd, ['-c', 'user.email=e2e@mainframe.test', '-c', 'user.name=Mainframe E2E', 'commit', '-m', message]);
}

/**
 * Commit the project's seed files as a clean baseline, then make exactly 2
 * pure-append modifications (+1/-0 each) so the Changes row reads a
 * deterministic "2 files · +2 −0" every run.
 */
function dirtyRepo(dir: string): void {
  git(dir, ['add', '-A']);
  gitCommit(dir, 'baseline');
  appendFileSync(path.join(dir, 'index.ts'), 'export const farewell = "bye";\n');
  appendFileSync(path.join(dir, 'CLAUDE.md'), 'E2E dirty marker line.\n');
}

/** `.mainframe/launch.json` with two configs — nothing is ever started here. */
function seedLaunchConfigs(projectPath: string): void {
  const dir = path.join(projectPath, '.mainframe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'launch.json'),
    JSON.stringify(
      {
        version: '1.0',
        configurations: [
          { name: 'sleep-long', runtimeExecutable: 'sleep', runtimeArgs: ['60'] },
          { name: 'echo-once', runtimeExecutable: 'echo', runtimeArgs: ['hello-from-launch'] },
        ],
      },
      null,
      2,
    ),
  );
}

async function addFileMention(chatId: string, filePath: string): Promise<void> {
  const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}/mentions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'file', name: filePath.split('/').pop() ?? filePath, path: filePath }),
  });
  if (!res.ok) throw new Error(`addFileMention: POST /mentions failed (${res.status} ${await res.text()})`);
}

interface SeedAttachment {
  name: string;
  mediaType: string;
  data: string;
  kind: 'image' | 'file';
}

/** Seed attachments via the daemon's public upload route; returns their ids in order. */
async function addAttachments(chatId: string, attachments: SeedAttachment[]): Promise<string[]> {
  const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}/attachments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments }),
  });
  if (!res.ok) throw new Error(`addAttachments: POST /attachments failed (${res.status} ${await res.text()})`);
  const body = (await res.json()) as { data: { attachments: { id: string }[] } };
  return body.data.attachments.map((a) => a.id);
}

/** Re-select a chat row after a reload, which does not preserve the active thread. */
async function selectChat(page: Page, chatId: string): Promise<void> {
  await sessionsSidebar(page).row(chatId).click();
  await composer(page).input().waitFor({ timeout: 12_000 });
}

/**
 * Open the panel if it is not already on screen, and return its root.
 *
 * `title-bar-details` TOGGLES — firing it at a panel that is merely a beat
 * away from re-rendering closes it for good. At DOCKED this is almost always a
 * no-op (the panel auto-opens on boot), but opening the workspace surface
 * halves the chat column and can drop the panel below `INLINE_MIN_WIDTH`,
 * unmounting it entirely — so every content test calls this first rather than
 * assuming the previous test left it open.
 */
async function ensurePanelOpen(page: Page): Promise<Locator> {
  const workspaceSurface = page.getByTestId('workspace-surface');
  if (await workspaceSurface.isVisible().catch(() => false)) {
    await page.keyboard.press('ControlOrMeta+Shift+W');
    await expect(workspaceSurface).toHaveCount(0, { timeout: 5_000 });
  }
  const root = page.getByTestId('session-panel-root');
  await root.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {
    /* expected when the panel really is closed — the toggle below reopens it */
  });
  if ((await root.count()) === 0) {
    await page
      .getByTestId('session-panel-toggle')
      .click({ timeout: 5_000 })
      .catch(() => undefined /* the re-measure landed first and brought it back */);
  }
  await expect(root).toBeVisible({ timeout: 10_000 });
  return root;
}

/**
 * Dismiss a floating panel with Escape, retrying the press because a transient
 * Radix layer can legitimately eat one.
 *
 * ANY open Radix layer consumes an Escape — its DismissableLayer calls
 * `preventDefault`, and the panel's own handler bails on `defaultPrevented` by
 * design ("an open dialog owns Escape", use-session-panel-state.ts). A toggle
 * click leaves the pointer on a `Hint`-wrapped button and focus inside it, so
 * both doors have to be shut before Escape can reach the panel: one real click
 * on the floating column's Session section shuts both at once (closes any open
 * tooltip outright, and takes hover off the toggle without landing on
 * something that opens a layer of its own), which merely moving the pointer
 * does not.
 */
async function dismissOverlayWithEscape(page: Page): Promise<void> {
  const overlay = page.getByTestId('session-panel-overlay');
  await overlay.getByTestId('session-panel-section-summary').click({ position: { x: 4, y: 4 } });
  for (let attempt = 0; attempt < 3 && (await overlay.count()) > 0; attempt++) {
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached', timeout: 1_500 }).catch(() => {
      /* expected when a transient layer ate this press instead of the panel */
    });
  }
}

// ─── §session-panel — docking modes ───────────────────────────────────────────

test.describe('§session-panel — docking modes', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('DOCKED: the panel opens inline on its own, with no click', async () => {
    const { page } = app;
    await page.setViewportSize(DOCKED);
    const root = page.getByTestId('session-panel-root');
    await expect(root).toBeVisible({ timeout: 10_000 });
    await expect(root).toHaveAttribute('data-mode', 'inline');
    await expect(page.getByTestId('session-panel')).toBeVisible();
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-card-session')).toBeVisible();
    await expect(page.getByTestId('session-panel-toggle')).toHaveAttribute('aria-pressed', 'true');

    // Clicking the toggle while docked just closes it outright (no float — room was never the issue).
    await page.getByTestId('session-panel-toggle').click();
    await expect(root).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('session-panel-toggle')).toHaveAttribute('aria-pressed', 'false');

    // Restore for the tests below.
    await page.getByTestId('session-panel-toggle').click();
    await expect(root).toBeVisible({ timeout: 5_000 });
  });

  test('OVERLAY: starts hidden on a short column; the toggle floats it, and it light-dismisses', async () => {
    const { page } = app;
    await page.setViewportSize(OVERLAY);
    const root = page.getByTestId('session-panel-root');
    const overlay = page.getByTestId('session-panel-overlay');

    // The open bit is true (default), but the column is short of 1044 and
    // nothing has floated it yet — the panel renders nothing.
    await expect(root).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('session-panel-toggle')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('session-panel-toggle').click();
    await expect(root).toBeVisible({ timeout: 5_000 });
    await expect(root).toHaveAttribute('data-mode', 'overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('role', 'dialog');
    await expect(page.getByTestId('session-panel-scrim')).toBeVisible();
    await expect(overlay.getByTestId('session-panel-card-session')).toBeVisible();
    // Not the docked form: the inline wrapper never mounts alongside the float.
    await expect(page.getByTestId('session-panel')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-toggle')).toHaveAttribute('aria-pressed', 'true');

    await dismissOverlayWithEscape(page);
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
    await expect(root).toHaveCount(0);
  });

  test('OVERLAY: a pointer outside the floated column dismisses it too', async () => {
    const { page } = app;
    await page.setViewportSize(OVERLAY);
    const overlay = page.getByTestId('session-panel-overlay');

    await page.getByTestId('session-panel-toggle').click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The title bar sits above the host row the panel spans, so its own empty
    // (aria-hidden) traffic-light reserve is a reliably un-covered outside
    // target — the floating column overlays only the transcript/composer below it.
    await page.getByTestId('title-bar').click({ position: { x: 2, y: 2 } });
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('OVERLAY: a click on the scrim closes the floated panel', async () => {
    const { page } = app;
    await page.setViewportSize(OVERLAY);
    const overlay = page.getByTestId('session-panel-overlay');
    const toggle = page.getByTestId('session-panel-toggle');

    await toggle.click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The full-height float covers the column header (and its toggle), so the
    // scrim beside it is the close target, alongside Escape.
    await page.getByTestId('session-panel-scrim').click({ position: { x: 10, y: 200 } });
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('session-panel-root')).toHaveCount(0);
  });

  // Replaces the old rail's "survives a width that fits neither the stack nor
  // a gutter" — there is no rail any more, but the title bar's toggle is shell
  // chrome, not a measured element, so it must survive the same width.
  test('HIDDEN: the panel renders nothing by default, and the toggle survives the width', async () => {
    const { page } = app;
    await page.setViewportSize(HIDDEN);
    await expect(page.getByTestId('session-panel-root')).toHaveCount(0, { timeout: 10_000 });
    const toggle = page.getByTestId('session-panel-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();

    // It still floats the panel at this width, same as OVERLAY.
    await toggle.click();
    await expect(page.getByTestId('session-panel-overlay')).toBeVisible({ timeout: 5_000 });
    await dismissOverlayWithEscape(page);
    await expect(page.getByTestId('session-panel-root')).toHaveCount(0, { timeout: 5_000 });
  });
});

// ─── §session-panel — the panel's sections, all open together ────────────────
//
// There is no more per-card toggle: Session, Pull requests, Context, Activity,
// Tasks and Launch all render as soon as the panel is open. This describe
// folds what used to be separate rail-button tests into straight content
// assertions against the one scrolling column.

test.describe('§session-panel — sections', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    seedLaunchConfigs(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('Summary is always expanded and carries no collapse trigger', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-section-summary')).toBeVisible();
    await expect(page.getByTestId('session-panel-section-toggle-summary')).toHaveCount(0);
  });

  test('the Activity section renders empty with no live dot when nothing is running', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-card-activity')).toBeVisible();
    await expect(page.getByTestId('session-panel-activity-live')).toHaveCount(0);
    const empty = page.getByTestId('session-panel-activity-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText('Nothing running');
  });

  test('the Tasks section offers quick-add with a project active', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-card-tasks')).toBeVisible();
    // A project is active, so the section offers creation rather than the
    // no-project note. Row/modal behavior belongs to tasks.spec.ts.
    await expect(page.getByTestId('session-panel-tasks-new')).toBeVisible();
    await expect(page.getByTestId('session-panel-tasks-no-project')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-tasks-empty')).toBeVisible();
  });

  test('the Launch section lists every config with a start glyph and no live rows', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-card-launch')).toBeVisible();

    const sleepRow = page.getByTestId('session-panel-launch-row-sleep-long');
    await expect(sleepRow).toBeVisible({ timeout: 10_000 });
    await expect(sleepRow).toContainText('sleep-long');
    // Nothing started in this describe — every row offers Start, none offers Stop,
    // and the eyebrow carries no running dot.
    await expect(page.getByTestId('session-panel-launch-start-sleep-long')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-stop-sleep-long')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-launch-row-echo-once')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-start-echo-once')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-empty')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-launch-live')).toHaveCount(0);
    // Launch lifecycle (start/stop, status, console) belongs to workspace-surface.spec.ts.
  });
});

// ─── §session-panel — Summary rows ────────────────────────────────────────────
//
// `chat-status` replays an onMessage + onResult carrying real usage numbers, so
// the context row is reachable. The context percent this row reports is the
// ONLY context readout the panel carries now — the old rail's own duplicate
// meter is gone with the rail itself (D20); the composer's own
// `composer-context-percent` chip (D19) is composer.spec.ts's territory.

test.describe('§session-panel — Summary rows', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'chat-status' });
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    dirtyRepo(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the branch row names the live branch and carries no worktree badge', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    const row = page.getByTestId('session-panel-summary-branch');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('main');
    // A main-repo session is not a worktree — the `wt` badge must not render.
    await expect(page.getByTestId('session-panel-summary-branch-wt')).toHaveCount(0);
    // The row IS the branch manager now (git-branch.spec.ts drives it): a plain
    // div would mean the entry point regressed.
    await expect(row).toHaveRole('button');
  });

  test('the changes row shows the +/- totals, with the file count on the tooltip only', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    const row = page.getByTestId('session-panel-summary-changes');
    await expect(row).toBeVisible({ timeout: 15_000 });
    // dirtyRepo(): two pure appends → +2, −0. A clean tree suppresses the +/− pair
    // entirely, so asserting them proves the non-zero branch. The file count left
    // the row (it widened it for nothing) and lives on the hover tooltip only.
    await expect(row).not.toContainText('files');
    await expect(row).toContainText('+2');
    await expect(row).toContainText('−0'); // U+2212 minus sign
  });

  test('the context row is absent before a turn and reports a real percentage after one', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    // No usage data yet — deriveSummaryRows drops the row rather than showing 0%.
    await expect(page.getByTestId('session-panel-summary-context')).toHaveCount(0);

    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');
    await waitForIdle(page, 60_000);

    const row = page.getByTestId('session-panel-summary-context');
    await expect(row).toBeVisible({ timeout: 15_000 });
    const text = (await row.textContent()) ?? '';
    const match = /(\d+)%/.exec(text);
    expect(match, `expected a percentage in "${text}"`).not.toBeNull();
    const percent = Number(match![1]);
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThanOrEqual(100);
  });

  test('clicking the changes row opens the review modal', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await page.getByTestId('session-panel-summary-changes').click();
    await expect(page.getByTestId('review-modal')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('review-close').click();
    await expect(page.getByTestId('review-modal')).toHaveCount(0, { timeout: 5_000 });
  });

  // DELETED (D20 — capability dropped, not moved): the old rail carried its own
  // context METER, a plain indicator duplicating the Session card's row one
  // click away, specifically so the number was reachable without opening the
  // card. There is no rail any more — the Session section is always part of
  // the one open column — so there is nothing left to be "an indicator, not a
  // control" about. The underlying number is still covered by the test above.
});

// ─── §session-panel — Plan section (todo-write) ───────────────────────────────

test.describe('§session-panel — Plan section', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'todo-write' });
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // The recording's TodoWrite call also renders as a ToolFallback card in the
  // transcript, but the Plan section reads only the `todos.updated` store.
  test('the section is hidden until todos exist, then reports progress with the steps collapsed', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-plan')).toHaveCount(0);

    await sendMessage(page, 'Track two todos: write the README, then run the test suite');
    await waitForIdle(page, 60_000);

    const section = page.getByTestId('session-panel-plan');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // 1 completed + 1 in_progress → activeIndex 1 of 2 (todosToPlan).
    await expect(page.getByTestId('session-panel-plan-toggle')).toContainText('1 of 2');
    // Percentage width lives in an inline style — not resolvable via getComputedStyle.
    await expect(page.getByTestId('session-panel-plan-progress').locator('span')).toHaveAttribute(
      'style',
      /width:\s*50%/,
    );
    // ui-prefs default has plan collapsed: the header and bar show, the steps do not.
    await expect(page.getByTestId('session-panel-plan-step-0')).toHaveCount(0);
  });

  test('expanding the plan reveals the steps, with the in-progress one showing its activeForm', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-plan-toggle').click();

    await expect(page.getByTestId('session-panel-plan-step-0')).toHaveText('Write the README', { timeout: 5_000 });
    // in_progress steps render `activeForm`, not `content`.
    await expect(page.getByTestId('session-panel-plan-step-1')).toHaveText('Running the test suite');
  });

  test('collapsing the plan hides the steps but keeps the header and progress bar', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-plan-toggle').click();
    await expect(page.getByTestId('session-panel-plan-step-0')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('session-panel-plan-toggle')).toBeVisible();
    await expect(page.getByTestId('session-panel-plan-progress')).toBeVisible();
  });
});

// ─── §session-panel — Context section (REST-seeded) ───────────────────────────

test.describe('§session-panel — Context section', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;
  let imageAttachmentId: string;
  let fileAttachmentId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');

    // Adapter-independent seeds (see the ground-truth note): one user file
    // mention (Session badge '@') plus one image + one non-image attachment.
    await addFileMention(chatId, 'index.ts');
    const ids = await addAttachments(chatId, [
      { name: 'thumb.png', mediaType: 'image/png', data: TINY_PNG_BASE64, kind: 'image' },
      { name: 'notes.txt', mediaType: 'text/plain', data: Buffer.from('hello').toString('base64'), kind: 'file' },
    ]);
    imageAttachmentId = ids[0]!;
    fileAttachmentId = ids[1]!;

    // Attachment upload broadcasts no WS event (only addMention does) — reload to
    // force a fresh GET /api/chats/:id/context that picks up everything seeded.
    await app.page.reload();
    await waitConnected(app.page);
    await selectChat(app.page, chatId);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('context kinds are first-class sections — no Context wrapper, no counts', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    // 1 mention + 2 attachments under mock-cli; memory files and invoked skills
    // come back empty (get_context_files / extract_skill_files return defaults).
    await expect(page.getByTestId('session-panel-section-mentions')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('session-panel-section-attachments')).toBeVisible();
    await expect(page.getByTestId('session-panel-section-skills')).toBeVisible();
    await expect(page.getByTestId('session-panel-section-toggle-context')).toHaveCount(0);
    // No memory files here, so that section hides rather than showing empty.
    await expect(page.getByTestId('session-panel-section-memory')).toHaveCount(0);
  });

  test('the Mentioned files section lists the seeded mention with its @ badge', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    const item = page.getByTestId('session-panel-session-item-index.ts');
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item).toContainText('index.ts');
    await expect(item).toContainText('@');
  });

  test('clicking a Mentioned files row opens the file as a workspace editor tab', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await page.getByTestId('session-panel-session-item-index.ts').click();
    const strip = page.locator(WORKSPACE.strip);
    await expect(strip.getByRole('tab', { selected: true })).toContainText('index.ts', { timeout: 10_000 });
  });

  // The sub-group lists SESSION-INVOKED skills, and mock-cli's
  // `extract_skill_files()` returns `[]`, so no row is reachable here — same
  // shape as the memory-file sub-group above. What must hold is that the group
  // still renders: its Manage link is the only route to the advisor's skills
  // sheet, which owns the available-skills catalog this panel stopped listing.
  test('the Skills section shows its empty state and keeps Manage reachable', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    const empty = page.getByTestId('session-panel-skills-empty');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText('No skills used');
    await expect(page.locator('[data-testid^="session-panel-skill-/"]')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-skills-manage')).toBeVisible();
  });

  test('attachment tiles render; the image tile opens the lightbox', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-attachment-grid')).toBeVisible({ timeout: 15_000 });
    const imageTile = page.getByTestId(`session-panel-attachment-${imageAttachmentId}`);
    const fileTile = page.getByTestId(`session-panel-attachment-${fileAttachmentId}`);
    await expect(imageTile).toBeVisible();
    await expect(fileTile).toBeVisible();

    // The tile only joins the lightbox's image set once its base64 fetch resolves —
    // wait for the real <img> rather than clicking into an empty set.
    await expect(imageTile.locator('img')).toBeVisible({ timeout: 10_000 });
    await imageTile.click();
    await expect(page.getByTestId('image-lightbox-dialog')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('image-lightbox-dialog')).toHaveCount(0, { timeout: 5_000 });
  });

  test('the non-image tile does not open the lightbox', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await page.getByTestId(`session-panel-attachment-${fileAttachmentId}`).click();
    await expect(page.getByTestId('image-lightbox-dialog')).toHaveCount(0);
  });
});

// ─── §session-panel — Activity section, a live agent row (task-subagent) ─────
//
// task-subagent.0 is now two turns (todo #327): the first delegates to a
// subagent and completes the turn with the Task tool_use still unresolved, the
// second's tool_result closes it. That gap is what gives Activity a real
// "something is running" fixture, mirroring the mainframe-adapter-mock
// `task_bridge.rs` unit coverage at the daemon level.

test.describe('§session-panel — Activity section (task-subagent)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'task-subagent' });
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a delegated subagent shows one running Agent row until its result lands', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate finding the greeting export to a subagent');
    await waitForIdle(page, 60_000);

    const card = await ensurePanelOpen(page).then(() => page.getByTestId('session-panel-card-activity'));
    await expect(card).toBeVisible({ timeout: 5_000 });

    const row = card.getByTestId('session-panel-task-mock-toolu_task_1');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByTestId('session-panel-kind-agent')).toBeVisible();
    await expect(row).toContainText('Agent');

    await expect(page.getByTestId('session-panel-activity-live')).toBeVisible();

    await sendMessage(page, 'Thanks — what did it find?');
    await waitForIdle(page, 60_000);

    await expect(row).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('session-panel-activity-empty')).toBeVisible();
    await expect(page.getByTestId('session-panel-activity-live')).toHaveCount(0);
  });
});
