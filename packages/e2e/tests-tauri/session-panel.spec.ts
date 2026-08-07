/**
 * §session-panel — the right-hand session panel (rail · inline card · floating
 * overlay) and its five sections.
 *
 * Replaces `context-panel.spec.ts`, which covered the bottom Context/Skills/Agents
 * panel deleted in the right-sidebar revamp (T5.4). Scenarios are retargeted, not
 * rewritten: the Session sub-group's mention/attachment/lightbox coverage comes
 * straight from that spec. Its available-skills-catalog coverage did NOT survive
 * — the Skills sub-group lists session-invoked skills now, and the catalog moved
 * to the Setup Advisor (see the ground-truth note below).
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
 * suite runs at Playwright's 1280×720 default. The panel floats over the gutter
 * beside the transcript instead of taking width from it, so inline needs the host
 * row to clear `INLINE_MIN_WIDTH = 1468` (panel-mode.ts) — the centred `max-w-3xl`
 * column (768px) plus a 350px panel block in EACH gutter. A 1280 viewport, minus
 * the 256px sidebar and the AppShell `p-2 gap-2` insets, leaves a ~1000px host:
 * rail, with no ambiguity. Every describe therefore calls `page.setViewportSize()`
 * explicitly: WIDE (2100 → host ~1820, ~290px of headroom) for the section tests,
 * NARROW (1200 → host ~920, inside the rail band 876–1467) for the rail/overlay
 * tests; TINY (900 → host ~620, under RAIL_MIN_WIDTH 876) proves the hidden
 * regime — nothing may overlap the transcript. Mode is asserted by
 * `session-panel` vs `session-panel-rail` VISIBILITY, never by measuring boxes.
 *
 * ── The card and the rail never show together ────────────────────────────────
 * Inline renders the card ALONE. The rail appears only when the card is not
 * inline — the gutter is too short, or the user collapsed it via
 * `session-panel-collapse`. Any assertion that wants a rail control at WIDE has
 * to collapse the panel first (and restore it, so later tests stay independent).
 *
 * ── Ground truth under mock-cli (read before adding assertions) ──────────────
 * Inherited verbatim from the deleted spec and re-verified against the Rust mock
 * adapter (`mainframe-adapter-mock/src/session_trait.rs`):
 *   - `get_context_files()` returns `ContextFiles::default()` — globalFiles and
 *     projectFiles are ALWAYS empty, seeded CLAUDE.md or not. The Context
 *     section's memory-file sub-group therefore never renders here; its absence
 *     is asserted (with this reason) rather than left unstated.
 *   - `extract_plan_files()` returns `[]` — the Session sub-group's 'plan' badge
 *     is unreachable.
 *   - `extract_skill_files()` returns `[]`, and the Skills sub-group now lists
 *     the skills the SESSION INVOKED (`SessionContext.skillFiles`) rather than
 *     the adapter's available-skills catalog. So no skill row is reachable here;
 *     the empty-state row + the Manage link are asserted instead, the same way
 *     the memory-file sub-group's absence is. Seeding `.claude/skills` no longer
 *     affects this panel — `listSkills` feeds the Setup Advisor, not the panel.
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
 *   session-panel-rail            — SessionPanelRail root pill; present only when the
 *                                   inline card is not (narrow gutter, or collapsed)
 *   session-panel-collapse        — the inline card's collapse control, on the Summary
 *                                   heading; persisted, so a collapse survives a reload
 *   session-panel-rail-open       — rail "Session panel" button (targets Summary; on a
 *                                   wide surface it restores the card INLINE, not floating)
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
 *   session-panel-skill-<path>    — a Skills sub-group row: a skill THIS session
 *                                   invoked; click opens its SKILL.md (unreachable here)
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

/** Chat-host width comfortably above / below `INLINE_MIN_WIDTH` (1532). */
const WIDE = { width: 2100, height: 900 };
const NARROW = { width: 1200, height: 900 };
const TINY = { width: 900, height: 900 };

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
 * Clear every Radix overlay before an Escape assertion, by taking hover AND
 * focus somewhere inert.
 *
 * ANY open Radix layer consumes the first Escape — its DismissableLayer calls
 * `preventDefault`, and the panel's own handler bails on `defaultPrevented` by
 * design ("an open dialog owns Escape", use-session-panel-state.ts). A rail
 * click leaves the pointer on a `Hint`-wrapped button and focus inside it, so
 * both doors have to be shut:
 *
 * One real click on the floating card's own Summary heading shuts every door at
 * once, which merely moving the pointer does not:
 *
 *   - a pointerdown closes an open Radix tooltip outright, instead of racing its
 *     open/close delays — a `toHaveCount(0)` wait can otherwise pass in the
 *     window BEFORE a scheduled layer opens.
 *   - it takes hover off the rail without parking on something else that opens a
 *     layer of its own. Parking over the sessions sidebar opens a row's
 *     `SessionMetaCard` hover card, which swallows Escape exactly like a tooltip
 *     would — and that hover card carries no `role`, so a tooltip-only or
 *     dialog-only check reports all-clear while the layer is up (found live).
 *   - the heading is a plain `div`: no `Hint`, no collapse trigger, nothing to
 *     toggle. And it is inside the panel root, so light dismiss reads it as
 *     "inside" and the card stays up.
 *
 * The wait is on `[data-radix-popper-content-wrapper]` — the one selector that
 * covers tooltips, hover cards, popovers and menus alike.
 */
async function settleForEscape(page: Page): Promise<void> {
  await page
    .getByTestId('session-panel-overlay')
    .getByTestId('session-panel-section-summary')
    .click({ position: { x: 4, y: 4 } });
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(0, { timeout: 5_000 });
}

/**
 * Put the panel back inline before reading the inline card.
 *
 * Opening a file lights the WORKSPACE surface, which halves the chat host — at
 * WIDE that lands the host near ~900px, below `INLINE_MIN_WIDTH`, so the inline
 * card unmounts and every section testid disappears. Found live: the Context
 * describe's file-opening tests silently broke the tests after them. ⌘2 toggles
 * the workspace back off; calling this first makes each test independent of what
 * the previous one opened, which also matters on a Playwright retry (hooks re-run,
 * but a mid-describe retry does not).
 *
 * A leftover collapse is undone the same way a user would — the rail's own
 * button — but that click is best-effort and bounded on purpose: hiding the
 * workspace re-widens the surface, so the rail can unmount between the check and
 * the click. The `toBeVisible` below is the real assertion; a click that was
 * genuinely needed and failed surfaces there, with the card named.
 */
async function ensureInlinePanel(page: Page): Promise<void> {
  const workspaceSurface = page.getByTestId('workspace-surface');
  if (await workspaceSurface.isVisible().catch(() => false)) {
    await page.keyboard.press('ControlOrMeta+2');
    await expect(workspaceSurface).toHaveCount(0, { timeout: 5_000 });
  }
  const card = page.getByTestId('session-panel');
  if ((await card.count()) === 0) {
    await page
      .getByTestId('session-panel-rail-open')
      .click({ timeout: 5_000 })
      .catch(() => undefined /* the widen already restored the card */);
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
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

  test('a wide surface renders the inline card alone — no rail, no overlay', async () => {
    const { page } = app;
    await page.setViewportSize(WIDE);
    await expect(page.getByTestId('session-panel-root')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 10_000 });
    // The rail is the card's collapsed form, not its neighbour.
    await expect(page.getByTestId('session-panel-rail')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
  });

  test('collapsing a wide panel leaves the rail; a rail click restores it inline, not floating', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-collapse').click();
    await expect(page.getByTestId('session-panel')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('session-panel-rail')).toBeVisible();
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);

    // Room decides where the card goes: this gutter holds it, so the click puts
    // it back inline rather than floating it over the transcript.
    await page.getByTestId('session-panel-rail-open').click();
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('session-panel-rail')).toHaveCount(0);
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

    // The rail is behind the collapse at this width. Nothing is running, so it
    // carries no live-work dot.
    await page.getByTestId('session-panel-collapse').click();
    await expect(page.getByTestId('session-panel-rail')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('session-panel-rail-activity-dot')).toHaveCount(0);

    await page.getByTestId('session-panel-rail-activity').click();

    // One click both restored the card inline and expanded what it targeted.
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 5_000 });
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

  test('a gutter under even the rail hides the panel entirely', async () => {
    const { page } = app;
    await page.setViewportSize(TINY);
    // Nothing may overlap the transcript: no card, no rail, no root.
    await expect(page.getByTestId('session-panel-root')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('session-panel-rail')).toHaveCount(0);
    await expect(page.getByTestId('session-panel')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
  });

  // Each overlay test narrows for itself: a mid-describe Playwright retry (and a
  // solo `-g` run) re-runs the test against a fresh WIDE app, where inline mode
  // has no rail at all — depending on the previous test's viewport is a trap.
  test('a rail click floats the panel; Escape dismisses it', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    const overlay = page.getByTestId('session-panel-overlay');

    await expect(page.getByTestId('session-panel-rail')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('session-panel-rail-open').click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay).toHaveAttribute('role', 'dialog');
    // Not a modal: the card floats over the thread but the inline card stays absent.
    await expect(page.getByTestId('session-panel')).toHaveCount(0);

    await settleForEscape(page);
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('a pointer outside the panel dismisses the floating card', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    const overlay = page.getByTestId('session-panel-overlay');

    await expect(page.getByTestId('session-panel-rail')).toBeVisible({ timeout: 10_000 });
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
    await page.setViewportSize(NARROW);
    const overlay = page.getByTestId('session-panel-overlay');
    const railOpen = page.getByTestId('session-panel-rail-open');

    await expect(page.getByTestId('session-panel-rail')).toBeVisible({ timeout: 10_000 });
    await railOpen.click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await railOpen.click();
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  // Dismissal here is a SECOND right-click, not Escape, and that is deliberate:
  // a right-click leaves the rail button's tooltip open, and that tooltip owns
  // the first Escape (see `settleForEscape`). Escape-to-dismiss is covered from the
  // left-click route above; this asserts the re-click-to-close branch for a
  // NON-summary section, which nothing else reaches.
  test('right-clicking the rail launch button floats the panel on the Launch section', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    // The rail's launch button is a quick ACTION on left-click; the right-click is
    // the documented route to config selection when the panel is rail-only.
    const railLaunch = page.getByTestId('session-panel-rail-launch');
    await expect(railLaunch).toBeVisible({ timeout: 10_000 });
    await railLaunch.click({ button: 'right' });
    const overlay = page.getByTestId('session-panel-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay.getByTestId('session-panel-launch-row-sleep-long')).toBeVisible({ timeout: 5_000 });

    await railLaunch.click({ button: 'right' });
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('widening the surface restores the inline card, and retires the rail', async () => {
    const { page } = app;
    await page.setViewportSize(WIDE);
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('session-panel-rail')).toHaveCount(0);
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

  test('the changes row shows the +/- totals, with the file count on the tooltip only', async () => {
    const { page } = app;
    const row = page.getByTestId('session-panel-summary-changes');
    await expect(row).toBeVisible({ timeout: 15_000 });
    // dirtyRepo(): two pure appends → +2, −0. A clean tree suppresses the +/− pair
    // entirely, so asserting them proves the non-zero branch. The file count left
    // the row (it widened it for nothing) and lives on the hover tooltip now.
    await expect(row).not.toContainText('files');
    await expect(row).toContainText('+2');
    await expect(row).toContainText('−0'); // U+2212 minus sign
  });

  test('the context row is absent before a turn and reports a real percentage after one', async () => {
    const { page } = app;
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

    // The rail's meter reads the same number through the same hook — reachable
    // at this width only behind the collapse, which is undone again so the next
    // test still finds the inline card.
    await page.getByTestId('session-panel-collapse').click();
    await expect(page.getByTestId('session-panel-rail-context')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('session-panel-rail-open').click();
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 5_000 });
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
    // 1 mention + 2 attachments; memory files and invoked skills are always 0
    // under mock-cli (get_context_files / extract_skill_files return defaults).
    await expect(header).toContainText('3', { timeout: 15_000 });
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

  // The sub-group lists SESSION-INVOKED skills, and mock-cli's
  // `extract_skill_files()` returns `[]`, so no row is reachable here — same
  // shape as the memory-file sub-group above. What must hold is that the group
  // still renders: its Manage link is the only route to the advisor's skills
  // sheet, which owns the available-skills catalog this panel stopped listing.
  test('the Skills sub-group shows its empty state and keeps Manage reachable', async () => {
    const { page } = app;
    await ensureInlinePanel(page);
    const empty = page.getByTestId('session-panel-skills-empty');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText('No skills used');
    await expect(page.locator('[data-testid^="session-panel-skill-/"]')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-skills-manage')).toBeVisible();
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
