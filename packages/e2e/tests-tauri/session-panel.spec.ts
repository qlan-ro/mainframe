/**
 * §session-panel — the right-hand session panel (rail · inline card · floating
 * overlay) and its five sections.
 *
 * Replaces `context-panel.spec.ts`, which covered the bottom Context/Skills/Agents
 * panel deleted in the right-sidebar revamp (T5.4). Scenarios are retargeted, not
 * rewritten: the Session sub-group's mention/attachment/lightbox coverage and the
 * Skills-row coverage come straight from that spec.
 *
 * Source read: packages/ui/src/features/session-panel/{SessionPanel,SessionPanelRail,
 * SessionRailButton,PanelSection,PanelSubGroup,SummarySection,PlanSection,AgentPlan,
 * ActivitySection,LaunchSection,ContextSection,ContextFileItem,PanelAttachmentsGrid,
 * panel-mode,use-session-panel-state,summary-view,plan-view,launch-view,context-groups,
 * derive-session-items}.tsx, packages/ui/src/store/{ui-prefs,session-todos}.ts,
 * packages/ui/src/features/sessions/new-thread/ChatSurface.tsx,
 * packages/core-rs/crates/mainframe-adapter-mock/src/session_trait.rs.
 *
 * ── Viewport is explicit here, unlike every other spec ───────────────────────
 * `fixtures/app-tauri.ts` calls `browser.newContext()` with no `viewport`, so the
 * suite runs at Playwright's 1280×720 default. Minus the 256px sidebar and the
 * AppShell `p-2 gap-2` insets, the chat host lands within ~10px of
 * `INLINE_MIN_WIDTH = 1000` (panel-mode.ts) — inline vs rail would be decided by
 * rounding. Every describe therefore calls `page.setViewportSize()` explicitly:
 * WIDE (1600 → host ~1320) for the section tests, NARROW (900 → host ~620) for
 * the rail/overlay test. Both clear the threshold by a wide margin. Mode is
 * asserted by `session-panel` vs `session-panel-rail` VISIBILITY, never by
 * measuring boxes.
 *
 * ── Ground truth under mock-cli (read before adding assertions) ──────────────
 * Inherited verbatim from the deleted spec and re-verified against the Rust mock
 * adapter (`mainframe-adapter-mock/src/session_trait.rs`):
 *   - `get_context_files()` returns `ContextFiles::default()` — globalFiles and
 *     projectFiles are ALWAYS empty, seeded CLAUDE.md or not. The Context
 *     section's memory-file sub-group therefore never renders here; its absence
 *     is asserted (with this reason) rather than left unstated.
 *   - `extract_plan_files()` / `extract_skill_files()` return `[]` — the 'plan'
 *     and 'skill' badges of the Session sub-group are unreachable.
 *   - `listSkills` IS implemented (project scope, `.claude/skills/<name>/SKILL.md`
 *     — skills.rs), so seeding that directory does populate the Skills sub-group.
 *   - The mock adapter emits NO `background_task.*` events (no recording carries
 *     one either — grepped), so Background Activity's running state is not
 *     reachable. Empty-state + rail affordance is the honest coverage.
 * The two adapter-independent seeds survive: `POST /api/chats/:id/mentions` and
 * `POST /api/chats/:id/attachments` write straight to the daemon.
 *
 * AGENTS ARE GONE (D15): the deleted spec's agent-row test has no successor —
 * `AgentsList` was removed and no surface lists `AgentConfig`. A deliberate,
 * documented capability loss, not an oversight.
 *
 * The context-window coverage below (Summary's `session-panel-summary-context`)
 * is the successor to chat-header.spec.ts's retired `chat-header-context` /
 * `chat-header-context-pct` meter (T5.5), which is why this file uses the
 * `chat-status` recording that spec used.
 *
 * Testid reference (verified against packages/ui/src):
 *   session-panel-root            — SessionPanel.tsx wrapper (rail + card); always mounted
 *   session-panel                 — the INLINE card (mounted only in inline mode)
 *   session-panel-overlay         — the FLOATING card (role=dialog, rail mode only)
 *   session-panel-rail            — SessionPanelRail root pill; visible in every mode
 *   session-panel-rail-open       — rail "Session panel" button (targets Summary)
 *   session-panel-rail-activity   — rail Background Activity button
 *   session-panel-rail-activity-dot — live-work marker (only when running > 0)
 *   session-panel-rail-context    — rail context meter (only when percent != null)
 *   session-panel-rail-launch     — rail launch quick action (left-click runs/stops,
 *                                   right-click opens the Launch section)
 *   session-panel-section-<plan|activity|launch|context> — PanelSection root
 *   session-panel-section-toggle-<id>  — its header row (the whole width is the trigger)
 *   session-panel-section-summary — SummarySection root (never collapsible → no toggle)
 *   session-panel-summary-branch  — branch row; session-panel-summary-branch-wt is its
 *                                   worktree badge (absent on a main-repo session)
 *   session-panel-summary-context — context-fill row ("42%")
 *   session-panel-summary-changes — working-changes row; click emits open-review
 *   session-panel-summary-pr-<number> — a detected-PR row (unseedable; see chat-header.spec.ts)
 *   session-panel-summary-empty   — no rows at all
 *   session-panel-plan            — PlanSection root (absent when there are no todos)
 *   session-panel-plan-toggle     — AgentPlan header ("{done} of {total}") + collapse trigger
 *   session-panel-plan-progress   — the progress track; its fill carries style="width: N%"
 *   session-panel-plan-step-<i>   — one plan step, keyed by position
 *   session-panel-activity-empty  — "Nothing running"
 *   session-panel-task-<id> / session-panel-workflow-<runKey> — live rows (unreachable, above)
 *   session-panel-launch-row-<name>   — a launch config row (whole row acts)
 *   session-panel-launch-start-<name> / -stop-<name> — the row's action glyph (a span
 *                                   INSIDE the row button; both are clickable)
 *   session-panel-launch-empty    — "No Launch Configurations"
 *   session-panel-context-file-<path> — a memory-file row (never rendered under mock-cli)
 *   session-panel-session-item-<path> — a Session sub-group row; click emits open-file
 *   session-panel-skill-<id>      — a Skills sub-group row; click opens its SKILL.md
 *   session-panel-skills-empty / session-panel-skills-manage — its empty state / Manage link
 *   session-panel-attachment-grid / session-panel-attachment-<id> — attachment tiles
 *   image-lightbox-dialog         — ImageLightbox content (opened by an image tile)
 *   review-modal                  — the Review panel the Changes row opens
 *   WORKSPACE.strip               — a workspace pane's tab strip (opened files land here)
 */
import { test, expect, type Page } from '@playwright/test';
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

/** Chat-host width comfortably above / below `INLINE_MIN_WIDTH` (1000). */
const WIDE = { width: 1600, height: 900 };
const NARROW = { width: 900, height: 900 };

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

/** MockCliAdapter.listSkills scans ONLY `<projectPath>/.claude/skills` (skills.rs). */
function seedSkill(projectPath: string): void {
  const skillDir = path.join(projectPath, '.claude', 'skills', 'write-tests');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: Write Tests\ndescription: Write comprehensive unit tests for a module.\n---\n\n# Write Tests\n',
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
 * Put the panel back inline before reading the inline card.
 *
 * Opening a file lights the WORKSPACE surface, which halves the chat host — at
 * WIDE that lands the host near ~660px, below `INLINE_MIN_WIDTH`, so the inline
 * card unmounts and every section testid disappears. Found live: the Context
 * describe's file-opening tests silently broke the tests after them. ⌘2 toggles
 * the workspace back off; calling this first makes each test independent of what
 * the previous one opened, which also matters on a Playwright retry (hooks re-run,
 * but a mid-describe retry does not).
 */
async function ensureInlinePanel(page: Page): Promise<void> {
  const workspaceSurface = page.getByTestId('workspace-surface');
  if (await workspaceSurface.isVisible().catch(() => false)) {
    await page.keyboard.press('ControlOrMeta+2');
    await expect(workspaceSurface).toHaveCount(0, { timeout: 5_000 });
  }
  await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 10_000 });
}

// ─── §session-panel — inline / rail / overlay ─────────────────────────────────
//
// The only describe that changes viewport mid-run. It also owns the rail's own
// affordances and the Background Activity + Launch sections, whose content is
// static under mock-cli — folding them here avoids a fixture per section.

test.describe('§session-panel — modes, rail, activity, launch', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    await app.page.setViewportSize(WIDE);
    project = await createTauriProject(app.page);
    seedLaunchConfigs(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a wide surface renders the inline card beside the rail, with no overlay', async () => {
    const { page } = app;
    await page.setViewportSize(WIDE);
    await expect(page.getByTestId('session-panel-root')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 10_000 });
    // The rail is not an alternative to the card — it is always present.
    await expect(page.getByTestId('session-panel-rail')).toBeVisible();
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
  });

  test('Summary is always expanded and carries no collapse trigger', async () => {
    const { page } = app;
    await expect(page.getByTestId('session-panel-section-summary')).toBeVisible();
    await expect(page.getByTestId('session-panel-section-toggle-summary')).toHaveCount(0);
  });

  test('Background Activity starts collapsed, and the rail button expands it to the empty state', async () => {
    const { page } = app;
    // ui-prefs default: activity closed, so its body is not in the DOM yet.
    await expect(page.getByTestId('session-panel-activity-empty')).toHaveCount(0);
    // Nothing is running, so the rail carries no live-work dot.
    await expect(page.getByTestId('session-panel-rail-activity-dot')).toHaveCount(0);

    await page.getByTestId('session-panel-rail-activity').click();

    const empty = page.getByTestId('session-panel-activity-empty');
    await expect(empty).toBeVisible({ timeout: 5_000 });
    await expect(empty).toHaveText('Nothing running');
  });

  test('the section header toggles collapse back and forth', async () => {
    const { page } = app;
    const toggle = page.getByTestId('session-panel-section-toggle-activity');
    await toggle.click();
    await expect(page.getByTestId('session-panel-activity-empty')).toHaveCount(0, { timeout: 5_000 });
    await toggle.click();
    await expect(page.getByTestId('session-panel-activity-empty')).toBeVisible({ timeout: 5_000 });
  });

  test('the Launch section lists every config with a start glyph and no live rows', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-section-toggle-launch').click();

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

  test('narrowing the surface collapses the card to the rail alone', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    await expect(page.getByTestId('session-panel')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('session-panel-rail')).toBeVisible();
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
  });

  test('a rail click floats the panel; Escape dismisses it', async () => {
    const { page } = app;
    const overlay = page.getByTestId('session-panel-overlay');

    await page.getByTestId('session-panel-rail-open').click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay).toHaveAttribute('role', 'dialog');
    // Not a modal: the card floats over the thread but the inline card stays absent.
    await expect(page.getByTestId('session-panel')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('a pointer outside the panel dismisses the floating card', async () => {
    const { page } = app;
    const overlay = page.getByTestId('session-panel-overlay');

    await page.getByTestId('session-panel-rail-open').click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The chat header sits ABOVE the host row the panel root spans, so it is the
    // one reliably un-covered outside target: the floating card overlays the
    // thread column (including the composer) at this width. Its top-left corner is
    // the header's own padding — no child control, and `data-drag-region` is inert
    // outside Tauri.
    await page.getByTestId('chat-header').click({ position: { x: 2, y: 2 } });
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('re-clicking the rail button that opened the overlay closes it again', async () => {
    const { page } = app;
    const overlay = page.getByTestId('session-panel-overlay');
    const railOpen = page.getByTestId('session-panel-rail-open');

    await railOpen.click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await railOpen.click();
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  // Dismissal here is a SECOND right-click, not Escape, and that is deliberate.
  // Verified live with an in-page probe: a right-click leaves the rail button's
  // Radix tooltip open (a left-click closes it), and the tooltip's DismissableLayer
  // consumes the first Escape — `defaultPrevented` is already true by the time the
  // panel's own document handler sees it, and that handler bails on
  // `defaultPrevented` by design ("an open dialog owns Escape",
  // use-session-panel-state.ts). Escape-to-dismiss is covered from the left-click
  // route above; this asserts the re-click-to-close branch for a NON-summary
  // section, which nothing else reaches.
  test('right-clicking the rail launch button floats the panel on the Launch section', async () => {
    const { page } = app;
    // The rail's launch button is a quick ACTION on left-click; the right-click is
    // the documented route to config selection when the panel is rail-only.
    const railLaunch = page.getByTestId('session-panel-rail-launch');
    await railLaunch.click({ button: 'right' });
    const overlay = page.getByTestId('session-panel-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay.getByTestId('session-panel-launch-row-sleep-long')).toBeVisible({ timeout: 5_000 });

    await railLaunch.click({ button: 'right' });
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('widening the surface restores the inline card', async () => {
    const { page } = app;
    await page.setViewportSize(WIDE);
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
  });
});

// ─── §session-panel — Summary rows ────────────────────────────────────────────
//
// `chat-status` replays an onMessage + onResult carrying real usage numbers, so
// the context row is reachable. Inherited from chat-header.spec.ts, whose meter
// this row replaces (T5.5).

test.describe('§session-panel — Summary rows', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'chat-status' });
    await app.page.setViewportSize(WIDE);
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
    const row = page.getByTestId('session-panel-summary-branch');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('main');
    // A main-repo session is not a worktree — the `wt` badge must not render.
    await expect(page.getByTestId('session-panel-summary-branch-wt')).toHaveCount(0);
  });

  test('the changes row counts the dirty files with their +/- totals', async () => {
    const { page } = app;
    const row = page.getByTestId('session-panel-summary-changes');
    await expect(row).toBeVisible({ timeout: 15_000 });
    // dirtyRepo(): two pure appends → 2 files, +2, −0. A clean tree suppresses the
    // +/− pair entirely, so asserting them proves the non-zero branch.
    await expect(row).toContainText('2 files');
    await expect(row).toContainText('+2');
    await expect(row).toContainText('−0'); // U+2212 minus sign
  });

  test('the context row is absent before a turn and reports a real percentage after one', async () => {
    const { page } = app;
    // No usage data yet — deriveSummaryRows drops the row rather than showing 0%.
    await expect(page.getByTestId('session-panel-summary-context')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-rail-context')).toHaveCount(0);

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

    // The rail's meter reads the same number through the same hook.
    await expect(page.getByTestId('session-panel-rail-context')).toBeVisible();
  });

  test('clicking the changes row opens the review modal', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-summary-changes').click();
    await expect(page.getByTestId('review-modal')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('review-close').click();
    await expect(page.getByTestId('review-modal')).toHaveCount(0, { timeout: 5_000 });
  });
});

// ─── §session-panel — Plan section (todo-write) ───────────────────────────────

test.describe('§session-panel — Plan section', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'todo-write' });
    await app.page.setViewportSize(WIDE);
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
    await app.page.setViewportSize(WIDE);
    project = await createTauriProject(app.page);
    seedSkill(project.projectPath);
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

  test('the section is expanded by default and counts every sub-group row', async () => {
    const { page } = app;
    await ensureInlinePanel(page);
    const header = page.getByTestId('session-panel-section-toggle-context');
    await expect(header).toBeVisible({ timeout: 15_000 });
    // 1 mention + 1 skill + 2 attachments; memory files are always 0 under mock-cli.
    await expect(header).toContainText('4', { timeout: 15_000 });
    // No memory-file rows exist here: get_context_files() returns the default empty
    // pair, so the "Context" sub-group has nothing to render.
    await expect(page.locator('[data-testid^="session-panel-context-file-"]')).toHaveCount(0);
  });

  test('the Session sub-group lists the seeded mention with its @ badge', async () => {
    const { page } = app;
    await ensureInlinePanel(page);
    const item = page.getByTestId('session-panel-session-item-index.ts');
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item).toContainText('index.ts');
    await expect(item).toContainText('@');
  });

  test('clicking the Session row opens the file as a workspace editor tab', async () => {
    const { page } = app;
    await ensureInlinePanel(page);
    await page.getByTestId('session-panel-session-item-index.ts').click();
    const strip = page.locator(WORKSPACE.strip);
    await expect(strip.getByRole('tab', { selected: true })).toContainText('index.ts', { timeout: 10_000 });
  });

  test('the Skills sub-group lists the seeded project skill and opens its SKILL.md', async () => {
    const { page } = app;
    await ensureInlinePanel(page);
    const row = page.getByTestId('session-panel-skill-mock-cli:project:write-tests');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('/Write Tests');
    await expect(page.getByTestId('session-panel-skills-empty')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-skills-manage')).toBeVisible();

    await row.click();
    const strip = page.locator(WORKSPACE.strip);
    await expect(strip.getByRole('tab', { selected: true })).toContainText('SKILL.md', { timeout: 10_000 });
  });

  test('attachment tiles render; the image tile opens the lightbox', async () => {
    const { page } = app;
    await ensureInlinePanel(page);
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
    await ensureInlinePanel(page);
    await page.getByTestId(`session-panel-attachment-${fileAttachmentId}`).click();
    await expect(page.getByTestId('image-lightbox-dialog')).toHaveCount(0);
  });

  test('collapsing the section hides every sub-group; expanding restores them', async () => {
    const { page } = app;
    await ensureInlinePanel(page);
    const header = page.getByTestId('session-panel-section-toggle-context');
    const item = page.getByTestId('session-panel-session-item-index.ts');
    await expect(item).toBeVisible();

    await header.click();
    await expect(item).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('session-panel-attachment-grid')).toHaveCount(0);

    await header.click();
    await expect(item).toBeVisible({ timeout: 5_000 });
  });
});
