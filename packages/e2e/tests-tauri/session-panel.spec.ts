/**
 * §session-panel — the session panel: a "Session" card whose sections (Pull
 * requests · Plan · Activity · Launch · Memory files · Mentioned files · Skills ·
 * Attachments · Project tasks) each turn on or off in its Sections menu, docked
 * beside the transcript or floated over it. Spec: `design/redesign/DECISIONS.md`, rows R1–R13.
 *
 * Source read: packages/ui/src/features/session-panel/*,
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
 *   - `extract_skill_files()` returns `[]`, and the Skills sub-group lists the
 *     skills the SESSION INVOKED (`SessionContext.skillFiles`) rather than the
 *     adapter's available-skills catalog. So no skill row is reachable here;
 *     the empty-state row + the Manage link are asserted instead, the same way
 *     the memory-file sub-group's absence is. Seeding `.claude/skills` no longer
 *     affects this panel — `listSkills` feeds the Setup Advisor, not the panel.
 *   - The mock adapter derives `background_task.*` events from replayed tool_use /
 *     tool_result blocks (todo #327's `task_bridge.rs`) rather than emitting them
 *     itself, so most recordings still carry none and Activity reads empty for
 *     them. The Activity describes below use the recordings that do.
 * The two adapter-independent seeds survive: `POST /api/chats/:id/mentions` and
 * `POST /api/chats/:id/attachments` write straight to the daemon.
 *
 * Testid reference (verified against packages/ui/src):
 *   title-bar-details             — the panel's ONE switch (layout/TitleBar.tsx's right
 *                                    cluster); `aria-pressed` mirrors the persisted open bit
 *   session-panel-root[data-mode] — "inline" | "overlay" | "hidden" ("hidden" renders null)
 *   session-panel                 — the INLINE column's own wrapper (docked mode only)
 *   session-panel-overlay         — the FLOATING column's own root (role=dialog), with
 *                                    `session-panel-scrim` behind it
 *   session-panel-sections        — the one scrolling column, present in BOTH modes
 *   session-panel-sections-menu / -sections-menu-<key> — the Sections button and its checkbox items
 *   session-panel-section-prs     — Pull requests section; absent when the session has none
 *   session-panel-summary-pr-<number> — a detected-PR row, now inside `session-panel-section-prs`
 *                                    (unseedable in browser mode; see title-bar.spec.ts's
 *                                    identical note)
 *   session-panel-card-activity   — Activity section
 *   session-panel-activity-earlier — the collapsed Earlier group's row
 *   session-panel-plan            — PlanSection root (absent when there are no todos)
 *   session-panel-plan-toggle     — its header ("{done} of {total}") + disclosure
 *   session-panel-plan-current    — the step in progress, while folded
 *   session-panel-plan-step-<i>   — one plan step, keyed by position
 *   session-panel-activity-empty  — "No background activity": nothing is ongoing
 *   session-panel-activity-<entryId> — one row, keyed by the activity entry id
 *                                    (`task:<taskId>`, `delegated:<taskId>`, …); a
 *                                    the task-subagent, schedule-pills,
 *                                    background-command, workflow and Stop describes
 *                                    below cover each kind
 *   session-panel-activity-row-stop-<entryId> / -row-output-<entryId> — its Stop, and a background
 *                                    command's full output, shown on hover and focus
 *   session-panel-activity-output-<entryId> / session-panel-output-dialog — a background
 *                                    command's output, from its row menu
 *   session-panel-workflow-phase-<index> / -agent-<id> / -stop — an unfolded workflow
 *   session-panel-card-launch     — Launch section; ALWAYS rendered once the panel is open
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
 *   composer-branch / -worktree-trigger / -changes — the strip under the composer that took over
 *                                    the panel's Session section (git-branch.spec.ts drives it)
 *   review-modal                  — the Review panel the strip's changes open
 *   WORKSPACE.strip                — a workspace pane's tab strip (opened files land here)
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
import { daemonFetch, fetchRoute } from '../fixtures/daemon.js';

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
  const res = await daemonFetch(`/api/chats/${chatId}/mentions`, {
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
  const res = await daemonFetch(`/api/chats/${chatId}/attachments`, {
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
 * on the floating panel's own title shuts both at once (closes any open
 * tooltip outright, and takes hover off the toggle without landing on
 * something that opens a layer of its own), which merely moving the pointer
 * does not.
 */
async function dismissOverlayWithEscape(page: Page): Promise<void> {
  const overlay = page.getByTestId('session-panel-overlay');
  await overlay.getByRole('heading', { name: 'Session' }).click();
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
    await expect(page.getByTestId('session-panel').getByRole('heading', { name: 'Session' })).toBeVisible();
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
    await expect(overlay.getByRole('heading', { name: 'Session' })).toBeVisible();
    // Not the docked form: the inline wrapper never mounts alongside the float.
    await expect(page.getByTestId('session-panel')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-toggle')).toHaveAttribute('aria-pressed', 'true');

    await dismissOverlayWithEscape(page);
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
    await expect(root).toHaveCount(0);
    await expect(page.getByTestId('session-panel-toggle')).toBeFocused();
  });

  test('OVERLAY: the panel ends 8px above the composer, which stays usable', async () => {
    const { page } = app;
    await page.setViewportSize(OVERLAY);
    const overlay = page.getByTestId('session-panel-overlay');
    await page.getByTestId('session-panel-toggle').click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    const footer = (await page.getByTestId('chat-thread-footer').boundingBox())!;
    const scrim = (await page.getByTestId('session-panel-scrim').boundingBox())!;
    expect(Math.abs(footer.y - 8 - (scrim.y + scrim.height))).toBeLessThanOrEqual(1);

    await composer(page).input().click();
    await page.keyboard.type('still typing');
    await expect(composer(page).input()).toHaveValue('still typing');
    await expect(overlay).toBeVisible();
    await composer(page).input().fill('');

    // The float starts under the header, so the toggle that opened it closes it.
    await page.getByTestId('session-panel-toggle').click();
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
    await page.getByTestId('session-panel-toggle').click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await dismissOverlayWithEscape(page);
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

    await page.getByTestId('session-panel-scrim').click({ position: { x: 10, y: 100 } });
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('session-panel-root')).toHaveCount(0);
    await expect(toggle).toBeFocused();
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
// Every section the session has something for renders as soon as the panel is
// open, unless the viewer turned it off in the Sections menu.

test.describe('§session-panel — sections', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    seedLaunchConfigs(project.projectPath);
    chatId = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the Sections menu turns a section off and on, and remembers it', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-card-launch')).toBeVisible();

    await page.getByTestId('session-panel-sections-menu').click();
    const item = page.getByTestId('session-panel-sections-menu-launch');
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await item.click();
    // The menu stays open: several sections get toggled in one visit.
    await expect(item).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('session-panel-card-launch')).toHaveCount(0);

    await page.reload();
    await waitConnected(page);
    await selectChat(page, chatId);
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-card-activity')).toBeVisible();
    await expect(page.getByTestId('session-panel-card-launch')).toHaveCount(0);

    await page.getByTestId('session-panel-sections-menu').click();
    await page.getByTestId('session-panel-sections-menu-launch').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('session-panel-card-launch')).toBeVisible();
  });

  test('the Activity section renders empty when nothing is running', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-card-activity')).toBeVisible();
    const empty = page.getByTestId('session-panel-activity-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText('No background activity');
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
    // Nothing started in this describe — every row offers Start, none offers Stop.
    await expect(page.getByTestId('session-panel-launch-start-sleep-long')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-stop-sleep-long')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-launch-row-echo-once')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-start-echo-once')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-empty')).toHaveCount(0);
    // Launch lifecycle (start/stop, status, console) belongs to workspace-surface.spec.ts.
  });
});

// ─── §bottom-strip — where it runs, and its changes ─────────────────────────
//
// The strip under the composer took over the panel's Session section (R2).

test.describe('§bottom-strip — under the composer', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    dirtyRepo(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the branch control names the live branch of a local checkout', async () => {
    const { page } = app;
    const branch = page.getByTestId('composer-branch');
    await expect(branch).toBeVisible({ timeout: 15_000 });
    await expect(branch).toContainText('main');
    await expect(page.getByTestId('composer-worktree-trigger')).toContainText('Local');
    // It IS the branch manager (git-branch.spec.ts drives it): a plain element
    // would mean the entry point regressed.
    await expect(branch).toHaveRole('button');
  });

  test('the changes show the +/- totals and open the review', async () => {
    const { page } = app;
    const changes = page.getByTestId('composer-changes');
    await expect(changes).toBeVisible({ timeout: 15_000 });
    // dirtyRepo(): two pure appends → +2, −0.
    await expect(changes).toContainText('+2');
    await expect(changes).toContainText('−0'); // U+2212 minus sign
    await changes.click();
    await page.getByTestId('composer-changes-open-diff').click();
    await expect(page.getByTestId('review-modal')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('review-close').click();
    await expect(page.getByTestId('review-modal')).toHaveCount(0, { timeout: 5_000 });
  });

  test('before the first message: no strip, and only project-level sections', async () => {
    const { page } = app;
    await sessionsSidebar(page).newButton().click();
    await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
    await ensurePanelOpen(page);
    await expect(page.getByTestId('session-panel-section-skills')).toBeVisible();
    await expect(page.getByTestId('session-panel-card-tasks')).toBeVisible();
    await expect(page.getByTestId('session-panel-card-activity')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-card-launch')).toHaveCount(0);
    await expect(page.getByTestId('composer-bottom-strip')).toHaveCount(0);
  });
});

// ─── §session-panel — the context percentage ─────────────────────────────────
//
// The panel's context row is gone with its Session section (R2); the composer
// carries the only readout. `chat-status` replays real usage numbers.

test.describe('§session-panel — context percentage (composer)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'chat-status' });
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('it is absent before a turn and reports a real percentage after one', async () => {
    const { page } = app;
    const percentage = page.getByTestId('composer-context-percent');
    await expect(composer(page).input()).toBeVisible();
    await expect(percentage).toHaveCount(0);

    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');
    await waitForIdle(page, 60_000);

    await expect(percentage).toHaveText(/^\d+%$/, { timeout: 15_000 });
    const value = Number.parseInt((await percentage.textContent()) ?? '', 10);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(100);
  });
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

    await expect(page.getByTestId('session-panel-plan-toggle')).toContainText('1 of 2');
    // ui-prefs default has plan folded: only the step in progress shows.
    await expect(page.getByTestId('session-panel-plan-current')).toContainText('Running the test suite');
    await expect(page.getByTestId('session-panel-plan-step-0')).toHaveCount(0);
  });

  test('expanding the plan reveals the steps, with the in-progress one showing its activeForm', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-plan-toggle').click();

    await expect(page.getByTestId('session-panel-plan-step-0')).toContainText('Write the README', { timeout: 5_000 });
    // in_progress steps render `activeForm`, not `content`.
    await expect(page.getByTestId('session-panel-plan-step-1')).toContainText('Running the test suite');
  });

  test('folding the plan hides the steps but keeps the step in progress', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-plan-toggle').click();
    await expect(page.getByTestId('session-panel-plan-step-0')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('session-panel-plan-toggle')).toBeVisible();
    await expect(page.getByTestId('session-panel-plan-current')).toBeVisible();
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
    // mention ('mentioned') plus one image + one non-image attachment.
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

  test('the Mentioned files section lists the seeded mention with the reason it is here', async () => {
    const { page } = app;
    await ensurePanelOpen(page);
    const item = page.getByTestId('session-panel-session-item-index.ts');
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item).toContainText('index.ts');
    await expect(item).toContainText('mentioned');
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

    const row = card.getByTestId('session-panel-activity-task:mock-toolu_task_1');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toHaveAttribute('data-activity-state', 'running');
    await expect(row).toHaveAccessibleName(/^Agent: .+, running, /);
    await expect(card.locator('[data-testid^="session-panel-activity-task:"]')).toHaveCount(1);

    await sendMessage(page, 'Thanks — what did it find?');
    await waitForIdle(page, 60_000);

    // The finished row leaves the running list for the collapsed Earlier group.
    await expect(row).toHaveCount(0, { timeout: 10_000 });
    await expect(card.getByTestId('session-panel-activity-empty')).toBeVisible();
    await card.getByRole('button', { name: 'Earlier, 1 item' }).click();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-activity-state', 'completed');

    // The row opens the sub-agent's transcript beside the chat.
    await row.click();
    await expect(page.locator('[data-testid^="chat-subagent-zone-"]')).toBeVisible({ timeout: 10_000 });
  });
});

// ─── §session-panel — Activity section, the jump to the transcript ───────────
//
// Schedules, monitors and background commands have no detail of their own: a
// click goes to the marker or row that started them (R13).

test.describe('§session-panel — Activity section (schedule-pills)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'schedule-pills' });
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a schedule row goes to its marker and highlights it; a removed one waits under Earlier', async () => {
    const { page } = app;
    await sendMessage(page, 'Schedule a wakeup, create a cron job, list schedules, delete one, and monitor the build');
    await waitForIdle(page, 60_000);
    await ensurePanelOpen(page);

    const row = page.getByTestId('session-panel-activity-schedule:toolu_sched_1');
    await expect(row).toContainText(/in 1h \d+m/, { timeout: 10_000 });
    await row.click();
    const marker = page.locator('[data-activity-id="toolu_sched_1"]');
    await expect(marker).toBeInViewport();
    await expect(marker).toHaveAttribute('data-activity-flash', '');
    await expect(marker).not.toHaveAttribute('data-activity-flash', '', { timeout: 5_000 });

    await page.getByRole('button', { name: 'Earlier, 1 item' }).click();
    await expect(page.getByTestId('session-panel-activity-schedule:cron-1')).toContainText('removed');
  });
});

// ─── §session-panel — Activity section, background commands and monitors ─────
//
// The mock adapter tracks the background command itself; the monitor is added
// to the task list on the network boundary, with its recorded tool call.

test.describe('§session-panel — Activity section (background-command)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({
      recordingKey: 'background-command',
      beforeNavigate: async (page) => {
        await page.route(/\/api\/chats\/[^/]+\/background-tasks$/, async (route) => {
          const response = await fetchRoute(route);
          const { data } = (await response.json()) as { data: { tasks: object[] } };
          const monitor = {
            id: 'monitor-1',
            kind: 'other',
            toolName: 'Monitor',
            toolUseId: 'toolu_mon_1',
            command: 'Watch the build',
            description: 'Watch the build',
            outputPath: null,
            startedAt: Date.now(),
            endedAt: null,
            status: 'running',
            lastOutputLine: null,
            summary: null,
            usage: null,
          };
          await route.fulfill({ response, json: { success: true, data: { tasks: [...data.tasks, monitor] } } });
        });
        await page.route(/\/background-tasks\/mock-toolu_bg_1\/output/, (route) =>
          route.fulfill({
            body: '12 tests passed',
            headers: {
              'access-control-allow-origin': '*',
              'access-control-expose-headers': 'x-output-truncated',
              'x-output-truncated': 'true',
            },
          }),
        );
      },
    });
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendMessage(app.page, 'Run the tests in the background and watch the build');
    await waitForIdle(app.page, 60_000);
    await ensurePanelOpen(app.page);
    await app.page.getByRole('button', { name: 'Earlier, 1 item' }).click();
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  const commandRow = (page: Page) => page.getByTestId('session-panel-activity-task:mock-toolu_bg_1');

  test('a background command goes to its transcript row, opened on its result', async () => {
    const { page } = app;
    const target = page.locator('[data-activity-id="toolu_bg_1"]');
    await expect(commandRow(page)).toHaveAttribute('data-activity-state', 'completed');
    await commandRow(page).click();
    await expect(target).toHaveAttribute('data-activity-flash', '');
    await expect(target).toBeInViewport();
    await expect(target).toContainText('Command running in background with ID: bg_1');
    await expect(target.locator('[aria-expanded="true"]').first()).toBeFocused();
  });

  test('its full output is in the row menu, up to the daemon’s limit', async () => {
    const { page } = app;
    const request = page.waitForRequest(/\/background-tasks\/mock-toolu_bg_1\/output/);
    await commandRow(page).click({ button: 'right' });
    await page.getByTestId('session-panel-activity-output-task:mock-toolu_bg_1').click();
    expect(new URL((await request).url()).searchParams.get('bytes')).toBe('1048576');
    const dialog = page.getByTestId('session-panel-output-dialog');
    await expect(dialog.getByTestId('session-panel-output-text')).toHaveText('12 tests passed');
    await expect(dialog.getByTestId('session-panel-output-truncated')).toContainText('last 1 MB');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(commandRow(page)).toBeFocused();
  });

  test('its full output is a Tab away from the row', async () => {
    const { page } = app;
    const output = page.getByTestId('session-panel-activity-row-output-task:mock-toolu_bg_1');
    await commandRow(page).focus();
    await page.keyboard.press('Tab');
    await expect(output).toBeFocused();
    await expect(output.locator('..')).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('session-panel-output-dialog');
    await expect(dialog.getByTestId('session-panel-output-text')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(commandRow(page)).toBeFocused();
  });

  test('a monitor goes to its marker and opens it', async () => {
    const { page } = app;
    // Back to the end, so the jump has somewhere to go.
    await page.getByTestId('chat-thread-viewport').press('End');
    const target = page.locator('[data-activity-id="toolu_mon_1"]');
    await expect(target).not.toBeInViewport();
    await page.getByTestId('session-panel-activity-task:monitor-1').click();
    await expect(target).toHaveAttribute('data-activity-flash', '');
    await expect(target).toBeInViewport();
    await expect(target).toContainText('Build succeeded in 42s');
  });
});

// ─── §session-panel — Activity section, a workflow ───────────────────────────

test.describe('§session-panel — Activity section (workflow)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'workflow' });
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendMessage(app.page, 'Run the release-readiness workflow');
    await expect(app.page.getByText("I'll report when the last phase lands")).toBeVisible({ timeout: 60_000 });
    await ensurePanelOpen(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a workflow unfolds its phases, and the running one lists its agents', async () => {
    const { page } = app;
    const row = page.getByTestId('session-panel-activity-task:mock-toolu_wf');
    await expect(row).toContainText(/phase \d of 4/, { timeout: 10_000 });
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    const phases = page.locator('[data-testid^="session-panel-workflow-phase-"]');
    await expect(phases).toHaveCount(4);
    await expect(phases.first()).toContainText('1. Scan');
    await expect(phases.last()).toHaveAttribute('data-status', 'pending');

    // The mock adapter can't stop a task, so the run offers no Stop.
    await expect(page.getByTestId('session-panel-workflow-stop')).toHaveCount(0);

    const agent = page.locator('[data-testid^="session-panel-workflow-agent-"]').first();
    await expect(agent).toHaveAccessibleName(/, running, /);
    await agent.click();
    await expect(page.getByTestId('chat-workflow-panel-wf_rel_readiness_01')).toBeVisible();
    await page.keyboard.press('Escape');

    await row.click();
    await expect(phases).toHaveCount(0);
  });

  test('“N running tasks” brings back a hidden Activity section', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-sections-menu').click();
    await page.getByTestId('session-panel-sections-menu-activity').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('session-panel-card-activity')).toHaveCount(0);
    await page.getByRole('button', { name: '1 running task, show in Activity' }).click();
    await expect(page.getByTestId('session-panel-card-activity')).toBeInViewport();
  });
});

// ─── §session-panel — Activity section, Stop ─────────────────────────────────
//
// The mock adapter can't stop a background task, so Stop runs on a delegated
// task. `retries: 0`: see mcp-delegate.spec.ts, whose recording this is.

test.describe('§session-panel — Activity section (Stop)', () => {
  test.describe.configure({ retries: 0 });
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'mcp-delegate-stop' });
    await app.page.setViewportSize(DOCKED);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the row’s Stop shows on hover, ends the work with one request and leaves focus on the row', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate a long task, I will stop you after');
    await ensurePanelOpen(page);
    const row = page.locator('[data-testid^="session-panel-activity-delegated:"]');
    await expect(row).toHaveAttribute('data-activity-state', 'running', { timeout: 60_000 });
    await waitForIdle(page, 60_000);

    const stop = page.locator('[data-testid^="session-panel-activity-row-stop-delegated:"]');
    await page.mouse.move(0, 0);
    const actions = stop.locator('..');
    await expect(actions).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(actions).toHaveCSS('opacity', '1');

    const requests: string[] = [];
    page.on('request', (request) => {
      if (/\/delegated-tasks\/.*\/cancel$/.test(request.url()) && request.method() === 'POST')
        requests.push(request.url());
    });
    await page.mouse.move(0, 0);
    await row.focus();
    await page.keyboard.press('Tab');
    await expect(stop).toBeFocused();
    await expect(actions).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Stopped “.+”/)).toBeVisible({ timeout: 15_000 });
    // The mock child never ends its turn, so its row reads as a resumed chat
    // rather than stopped; the task itself is what Stop cancels.
    await expect(page.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'cancelled', {
      timeout: 15_000,
    });
    await expect(stop).toHaveCount(0);
    expect(requests).toHaveLength(1);
    await expect(row).toBeFocused();
  });
});
