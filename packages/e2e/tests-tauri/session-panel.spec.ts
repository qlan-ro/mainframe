/**
 * §session-panel — the right-hand session panel: the always-present rail and the
 * STACK of cards it toggles (inline beside the transcript, or floated over it).
 *
 * Replaces `context-panel.spec.ts`, which covered the bottom Context/Skills/Agents
 * panel deleted in the right-sidebar revamp (T5.4). Scenarios are retargeted, not
 * rewritten: the Session sub-group's mention/attachment/lightbox coverage comes
 * straight from that spec. Its available-skills-catalog coverage did NOT survive
 * — the Skills sub-group lists session-invoked skills now, and the catalog moved
 * to the Setup Advisor (see the ground-truth note below).
 *
 * Source read: packages/ui/src/features/session-panel/{SessionPanel,SessionPanelRail,
 * SessionRailButton,PanelCard,PanelSection,PanelSubGroup,SummarySection,PlanSection,
 * AgentPlan,ActivityCard,LaunchCard,TasksCard,ContextSection,ContextFileItem,
 * PanelAttachmentsGrid,panel-mode,use-session-panel-state,summary-view,plan-view,
 * launch-view,context-groups,derive-session-items}.tsx,
 * packages/ui/src/store/{ui-prefs,session-todos}.ts,
 * packages/ui/src/features/sessions/new-thread/ChatSurface.tsx,
 * packages/core-rs/crates/mainframe-adapter-mock/src/session_trait.rs.
 *
 * ── The rail is permanent; the stack is what comes and goes ──────────────────
 * The panel is a switchboard (the rail) plus zero or more open cards (the stack).
 * `SessionPanel.tsx` renders the rail in EVERY measured mode — it never hides
 * behind the thing it switches — so `hidden` now means only "not yet measured"
 * (width 0). The old "the card and the rail never show together" doctrine, and
 * the hidden-below-876px regime that went with it, are both gone.
 *
 * ── Viewport is explicit here, unlike every other spec ───────────────────────
 * `fixtures/app-tauri.ts` calls `browser.newContext()` with no `viewport`, so the
 * suite runs at Playwright's 1280×720 default. The stack floats over the gutter
 * beside the transcript instead of taking width from it, so inline needs the host
 * row to clear `INLINE_MIN_WIDTH = 1468` (panel-mode.ts: a 768px centred column
 * plus a 350px panel block in EACH gutter — the file's prose still quotes the
 * older 1532/382 pair, the constants are authoritative). A 1280 viewport, minus
 * the 256px sidebar and the AppShell `p-2 gap-2` insets, leaves a ~1000px host:
 * rail-only, with no ambiguity. Every describe therefore calls
 * `page.setViewportSize()` explicitly: WIDE (2100 → host ~1820, ~350px of
 * headroom) for the card-content tests, NARROW (1200 → host ~920) for the
 * rail/float tests, and TINY (900 → host ~620) to prove the rail survives a width
 * that fits nothing else. Mode is asserted by `session-panel` vs
 * `session-panel-overlay` presence with the rail alongside, never by measuring
 * boxes.
 *
 * ── Open-state is persisted, and shared across the tests in a describe ───────
 * `store/ui-prefs.ts` (v5, `mf:ui-prefs`) owns which cards are open —
 * `sessionPanelOpen`, defaulting to `{session:true}` and nothing else. A rail
 * click writes that preference, so a test that opens a card closes it again
 * before finishing, the same discipline the old file used for the collapse.
 * Nothing here seeds localStorage: the defaults are the contract under test.
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
 *   session-panel-root            — SessionPanel.tsx wrapper (rail + stack); mounted
 *                                   in every measured mode
 *   session-panel                 — the INLINE stack container (wide gutter only)
 *   session-panel-overlay         — the FLOATING stack (role=dialog), after a rail
 *                                   click on a short gutter
 *   session-panel-rail            — SessionPanelRail root pill; ALWAYS present,
 *                                   vertically centred
 *   session-panel-rail-open / -activity / -tasks / -launch — one toggle per card;
 *                                   `aria-pressed` mirrors the card being VISIBLE,
 *                                   so an open card whose stack is not floated
 *                                   reads false
 *   session-panel-rail-activity-dot / -launch-dot — live-work markers (running
 *                                   background work / a running launch config)
 *   session-panel-rail-context    — rail context meter (only when percent != null);
 *                                   opens the Session card AND expands Context
 *   session-panel-card-<session|activity|launch|tasks> — one open card
 *   session-panel-card-close-<id> — that card's header X
 *   session-panel-section-summary — SummarySection root, inside the Session card
 *                                   (never collapsible → no toggle)
 *   session-panel-section-<plan|context> — the two collapsible sections that stayed
 *                                   inside the Session card
 *   session-panel-section-toggle-<id>  — its header row (the whole width is the
 *                                   trigger); `data-state` reports open/closed
 *   session-panel-summary-branch  — branch row; a BUTTON opening BranchPopover now
 *                                   (see git-branch.spec.ts). -branch-wt is its
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
 *   session-panel-tasks-new / -tasks-empty / -tasks-no-project / -task-row-<number>
 *                                 — the Tasks card (its content is tasks.spec.ts's)
 *   session-panel-context-file-<path> — a memory-file row (never rendered under mock-cli)
 *   session-panel-session-item-<path> — a Session sub-group row; click emits open-file
 *   session-panel-skill-<path>    — a Skills sub-group row: a skill THIS session
 *                                   invoked; click opens its SKILL.md (unreachable here)
 *   session-panel-skills-empty / session-panel-skills-manage — its empty state / Manage link
 *   session-panel-attachment-grid / session-panel-attachment-<id> — attachment tiles
 *   image-lightbox-dialog         — ImageLightbox content (opened by an image tile)
 *   review-modal                  — the Review panel the Changes row opens
 *   WORKSPACE.strip               — a workspace pane's tab strip (opened files land here)
 *
 * RETIRED testids (do not re-assert): `session-panel-collapse` (close the card
 * instead), `session-panel-section-activity` / `-launch` and their toggles (both
 * are cards now).
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

/** Chat-host width comfortably above / below `INLINE_MIN_WIDTH` (1468), plus one
 *  that fits neither the stack nor a gutter — the rail must survive it. */
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
 * Dismiss the floating stack with Escape, retrying the press because a transient
 * Radix layer can legitimately eat one.
 *
 * ANY open Radix layer consumes an Escape — its DismissableLayer calls
 * `preventDefault`, and the panel's own handler bails on `defaultPrevented` by
 * design ("an open dialog owns Escape", use-session-panel-state.ts). A rail
 * click leaves the pointer on a `Hint`-wrapped button and focus inside it, so
 * both doors have to be shut before Escape can reach the panel:
 *
 * One real click on the floating Session card's Summary section shuts both doors
 * at once, which merely moving the pointer does not:
 *
 *   - a pointerdown closes an open Radix tooltip outright, instead of racing its
 *     open/close delays.
 *   - it takes hover off the rail without parking on something else that opens a
 *     layer of its own. Parking over the sessions sidebar opens a row's
 *     `SessionMetaCard` hover card, which swallows Escape exactly like a tooltip
 *     would — and that hover card carries no `role`, so a tooltip-only or
 *     dialog-only check reports all-clear while the layer is up (found live).
 *   - the Summary section is a plain `section` of static rows: no card header, no
 *     close X, nothing to toggle. And it is inside the panel root, so light
 *     dismiss reads it as "inside" and the stack stays up.
 *
 * That click cannot guarantee every door is shut, though: a hover-driven layer
 * (a tooltip or hover card whose open timer was already ticking) can still open
 * AFTER the click, inside this helper's own budget, and it would eat the next
 * Escape the same way. So this presses Escape up to 3 times, same shape as
 * `closeMenus` in helpers/tauri/menus.ts — press, give it a short settle to
 * consume, re-read the outcome — and returns as soon as the overlay is gone. A
 * press that gets swallowed by a transient layer just costs one more iteration
 * instead of failing the test; the caller still owns the authoritative
 * `expect(overlay).toHaveCount(0)` assertion, so a genuine regression fails
 * there and names the overlay.
 *
 * The click lands on the Session card's Summary, so the caller must leave that
 * card open — every caller here does.
 */
async function dismissOverlayWithEscape(page: Page): Promise<void> {
  const overlay = page.getByTestId('session-panel-overlay');
  await overlay.getByTestId('session-panel-section-summary').click({ position: { x: 4, y: 4 } });
  for (let attempt = 0; attempt < 3 && (await overlay.count()) > 0; attempt++) {
    await page.keyboard.press('Escape');
    // Each press needs its own settle before the count is read again — firing
    // them back-to-back sends every Escape into the same animation window,
    // where Radix has already handled the first and ignores the rest.
    await overlay.waitFor({ state: 'detached', timeout: 1_500 }).catch(() => {
      /* expected when a transient layer ate this press instead of the panel */
    });
  }
}

/**
 * Put the Session card back on screen before reading its content.
 *
 * Opening a file lights the WORKSPACE surface, which halves the chat host — at
 * WIDE that lands the host near ~900px, below `INLINE_MIN_WIDTH`, so the inline
 * stack unmounts and every card testid disappears (the rail stays, but its cards
 * do not). Found live: the Context describe's file-opening tests silently broke
 * the tests after them. ⌘2 toggles the workspace back off; calling this first
 * makes each test independent of what the previous one opened, which also matters
 * on a Playwright retry (hooks re-run, but a mid-describe retry does not).
 *
 * The rail click has to be BOTH conditional and late, and the wait before it is
 * load-bearing. `session-panel-rail-open` TOGGLES: firing it at a card that is
 * merely a beat away from re-rendering closes the card for good, and every later
 * test in the describe then fails on a panel nothing reopened. Hiding the
 * workspace does not restore the card synchronously — the width travels through a
 * ResizeObserver, so there is a window where the workspace is already unmounted
 * and the panel has not re-measured yet. Reading `count()` inside that window and
 * clicking on the strength of it is exactly the race that made this helper's
 * predecessor fail the test after every file-opening one (seen in both the old
 * and the new spec, same test, same shape). So: give the card a bounded chance to
 * come back on its own, and only click when it is genuinely closed.
 */
async function ensureSessionCard(page: Page): Promise<void> {
  const workspaceSurface = page.getByTestId('workspace-surface');
  if (await workspaceSurface.isVisible().catch(() => false)) {
    await page.keyboard.press('ControlOrMeta+2');
    await expect(workspaceSurface).toHaveCount(0, { timeout: 5_000 });
  }
  const card = page.getByTestId('session-panel-card-session');
  await card.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {
    /* expected when the card really is closed — the rail click below reopens it */
  });
  if ((await card.count()) === 0) {
    await page
      .getByTestId('session-panel-rail-open')
      .click({ timeout: 5_000 })
      .catch(() => undefined /* the re-measure landed first and brought it back */);
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
}

// ─── §session-panel — rail, stack, modes ──────────────────────────────────────
//
// The only describe that changes viewport mid-run. It also owns the rail's own
// affordances and the Background Activity + Launch + Tasks cards, whose content
// is static under mock-cli — folding them here avoids a fixture per card.

test.describe('§session-panel — rail, cards, modes', () => {
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

  test('a wide surface shows the rail and the inline stack, holding the Session card alone', async () => {
    const { page } = app;
    await page.setViewportSize(WIDE);
    await expect(page.getByTestId('session-panel-root')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 10_000 });
    // The rail is the switchboard, not the card's collapsed form: it renders
    // alongside the stack at every measured width.
    await expect(page.getByTestId('session-panel-rail')).toBeVisible();
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);

    // ui-prefs default: session open, everything else opt-in.
    await expect(page.getByTestId('session-panel-card-session')).toBeVisible();
    await expect(page.getByTestId('session-panel-card-activity')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-card-launch')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-card-tasks')).toHaveCount(0);

    // Engaged state follows the card being visible, not the raw preference bit.
    await expect(page.getByTestId('session-panel-rail-open')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-pressed', 'false');
  });

  test('closing the Session card empties the stack; the rail stays and reopens it', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-card-close-session').click();
    await expect(page.getByTestId('session-panel-card-session')).toHaveCount(0, { timeout: 5_000 });
    // An empty stack renders nothing at all — the container goes with the last card.
    await expect(page.getByTestId('session-panel')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-rail')).toBeVisible();
    await expect(page.getByTestId('session-panel-rail-open')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('session-panel-rail-open').click();
    await expect(page.getByTestId('session-panel-card-session')).toBeVisible({ timeout: 5_000 });
    // Room decides where the stack goes: this gutter holds it, so it comes back
    // inline rather than floating over the transcript.
    await expect(page.getByTestId('session-panel')).toBeVisible();
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
  });

  test('Summary is always expanded and carries no collapse trigger', async () => {
    const { page } = app;
    await expect(page.getByTestId('session-panel-section-summary')).toBeVisible();
    await expect(page.getByTestId('session-panel-section-toggle-summary')).toHaveCount(0);
  });

  test('the rail Activity button toggles its own card beside the Session card', async () => {
    const { page } = app;
    const activityCard = page.getByTestId('session-panel-card-activity');
    await expect(activityCard).toHaveCount(0);
    // Nothing is running, so the button carries no live-work dot.
    await expect(page.getByTestId('session-panel-rail-activity-dot')).toHaveCount(0);

    await page.getByTestId('session-panel-rail-activity').click();
    await expect(activityCard).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-pressed', 'true');
    const empty = page.getByTestId('session-panel-activity-empty');
    await expect(empty).toBeVisible({ timeout: 5_000 });
    await expect(empty).toHaveText('Nothing running');
    // Cards stack — opening one does not replace the Session card.
    await expect(page.getByTestId('session-panel-card-session')).toBeVisible();

    // The card's own X closes it and nothing else.
    await page.getByTestId('session-panel-card-close-activity').click();
    await expect(activityCard).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('session-panel-card-session')).toBeVisible();
  });

  test('the rail Tasks button toggles the Tasks card', async () => {
    const { page } = app;
    const tasksCard = page.getByTestId('session-panel-card-tasks');
    await expect(tasksCard).toHaveCount(0);

    await page.getByTestId('session-panel-rail-tasks').click();
    await expect(tasksCard).toBeVisible({ timeout: 5_000 });
    // A project is active, so the card offers creation rather than the
    // no-project note. Row/modal behavior belongs to tasks.spec.ts.
    await expect(page.getByTestId('session-panel-tasks-new')).toBeVisible();
    await expect(page.getByTestId('session-panel-tasks-no-project')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-tasks-empty')).toBeVisible();

    await page.getByTestId('session-panel-card-close-tasks').click();
    await expect(tasksCard).toHaveCount(0, { timeout: 5_000 });
  });

  test('the Launch card lists every config with a start glyph and no live rows', async () => {
    const { page } = app;
    await page.getByTestId('session-panel-rail-launch').click();
    await expect(page.getByTestId('session-panel-card-launch')).toBeVisible({ timeout: 5_000 });

    const sleepRow = page.getByTestId('session-panel-launch-row-sleep-long');
    await expect(sleepRow).toBeVisible({ timeout: 10_000 });
    await expect(sleepRow).toContainText('sleep-long');
    // Nothing started in this describe — every row offers Start, none offers Stop,
    // and the rail glyph carries no running dot.
    await expect(page.getByTestId('session-panel-launch-start-sleep-long')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-stop-sleep-long')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-launch-row-echo-once')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-start-echo-once')).toBeVisible();
    await expect(page.getByTestId('session-panel-launch-empty')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-rail-launch-dot')).toHaveCount(0);
    // Launch lifecycle (start/stop, status, console) belongs to workspace-surface.spec.ts.

    await page.getByTestId('session-panel-card-close-launch').click();
    await expect(page.getByTestId('session-panel-card-launch')).toHaveCount(0, { timeout: 5_000 });
  });

  test('narrowing the surface drops the stack and keeps the rail', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    await expect(page.getByTestId('session-panel')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('session-panel-rail')).toBeVisible();
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
    // The Session card is still OPEN as a preference — it is simply not showing,
    // and the rail's engaged state reports what is on screen.
    await expect(page.getByTestId('session-panel-card-session')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-rail-open')).toHaveAttribute('aria-pressed', 'false');
  });

  // Replaces the old "a gutter under even the rail hides the panel entirely":
  // the rail has no minimum width any more, so the honest assertion is that it
  // survives a surface that fits nothing else.
  test('the rail survives a width that fits neither the stack nor a gutter', async () => {
    const { page } = app;
    await page.setViewportSize(TINY);
    await expect(page.getByTestId('session-panel-root')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('session-panel-rail')).toBeVisible();
    await expect(page.getByTestId('session-panel-rail-open')).toBeVisible();
    // Still nothing overlapping the transcript unasked: no stack, no float.
    await expect(page.getByTestId('session-panel')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-overlay')).toHaveCount(0);
  });

  // Each floating test narrows for itself: a mid-describe Playwright retry (and a
  // solo `-g` run) re-runs the test against a fresh WIDE app, where the stack is
  // inline and no float exists — depending on the previous test's viewport is a trap.
  test('a rail click floats the stack; Escape dismisses it', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    const overlay = page.getByTestId('session-panel-overlay');

    await expect(page.getByTestId('session-panel-rail')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('session-panel-rail-open').click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay).toHaveAttribute('role', 'dialog');
    await expect(overlay.getByTestId('session-panel-card-session')).toBeVisible();
    // Not a modal, and not the inline stack: the cards float over the thread.
    await expect(page.getByTestId('session-panel')).toHaveCount(0);

    await dismissOverlayWithEscape(page);
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('a pointer outside the stack dismisses the floating cards', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    const overlay = page.getByTestId('session-panel-overlay');

    await expect(page.getByTestId('session-panel-rail')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('session-panel-rail-open').click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The chat header sits ABOVE the host row the panel root spans, so it is the
    // one reliably un-covered outside target: the floating stack overlays the
    // thread column (including the composer) at this width. Its top-left corner is
    // the header's own padding — no child control, and `data-drag-region` is inert
    // outside Tauri.
    await page.getByTestId('chat-header').click({ position: { x: 2, y: 2 } });
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('re-clicking the rail button that floated the stack closes its card', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    const overlay = page.getByTestId('session-panel-overlay');
    const railOpen = page.getByTestId('session-panel-rail-open');

    await expect(page.getByTestId('session-panel-rail')).toBeVisible({ timeout: 10_000 });
    await railOpen.click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The second click closes the CARD; the Session card was the only one open,
    // so the float has nothing left to show and goes with it.
    await railOpen.click();
    await expect(page.getByTestId('session-panel-card-session')).toHaveCount(0, { timeout: 5_000 });
    await expect(overlay).toHaveCount(0);

    // Restore the default for the tests below (and the next describe's app is
    // fresh, so this only matters within this one).
    await railOpen.click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await dismissOverlayWithEscape(page);
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  // The rail launch button no longer runs anything (that moved into the Launch
  // card's rows, workspace-surface.spec.ts) and no longer answers a right-click:
  // it is a plain toggle like its neighbours. What is worth pinning here is that
  // toggling one card in a floated stack leaves the others floating.
  test('the rail launch button adds and removes its card from the floating stack', async () => {
    const { page } = app;
    await page.setViewportSize(NARROW);
    const railLaunch = page.getByTestId('session-panel-rail-launch');
    const overlay = page.getByTestId('session-panel-overlay');
    await expect(railLaunch).toBeVisible({ timeout: 10_000 });

    await railLaunch.click();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay.getByTestId('session-panel-card-launch')).toBeVisible({ timeout: 5_000 });
    await expect(overlay.getByTestId('session-panel-launch-row-sleep-long')).toBeVisible({ timeout: 10_000 });
    await expect(railLaunch).toHaveAttribute('aria-pressed', 'true');
    // The Session card came along — the float shows the whole stack.
    await expect(overlay.getByTestId('session-panel-card-session')).toBeVisible();

    await railLaunch.click();
    await expect(page.getByTestId('session-panel-card-launch')).toHaveCount(0, { timeout: 5_000 });
    // Closing one card does not dismiss the float: the Session card is still up.
    await expect(overlay).toBeVisible();
    await expect(overlay.getByTestId('session-panel-card-session')).toBeVisible();

    await dismissOverlayWithEscape(page);
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
  });

  test('widening the surface restores the inline stack, and the rail stays', async () => {
    const { page } = app;
    await page.setViewportSize(WIDE);
    await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('session-panel-card-session')).toBeVisible();
    await expect(page.getByTestId('session-panel-rail')).toBeVisible();
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
    // The row IS the branch manager now (git-branch.spec.ts drives it): a plain
    // div would mean the entry point regressed.
    await expect(row).toHaveRole('button');
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

    // The rail's meter reads the same number through the same hook, and is
    // reachable without touching the card — the rail never hides now.
    await expect(page.getByTestId('session-panel-rail-context')).toContainText(`${percent}%`, { timeout: 10_000 });
  });

  // The meter NAVIGATES rather than toggling: it opens the Session card (never
  // closes it) and expands Context inside it, so it is a reliable route to the
  // section from any state.
  test('the rail meter opens the Session card and expands its Context section', async () => {
    const { page } = app;
    const contextToggle = page.getByTestId('session-panel-section-toggle-context');
    // Context is expanded by ui-prefs default — collapse it, so the expand below
    // is the meter's doing and not the initial state.
    await expect(contextToggle).toHaveAttribute('data-state', 'open');
    await contextToggle.click();
    await expect(contextToggle).toHaveAttribute('data-state', 'closed');

    await page.getByTestId('session-panel-card-close-session').click();
    await expect(page.getByTestId('session-panel-card-session')).toHaveCount(0, { timeout: 5_000 });

    await page.getByTestId('session-panel-rail-context').click();
    await expect(page.getByTestId('session-panel-card-session')).toBeVisible({ timeout: 5_000 });
    await expect(contextToggle).toHaveAttribute('data-state', 'open');
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
    await ensureSessionCard(page);
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
    await ensureSessionCard(page);
    const item = page.getByTestId('session-panel-session-item-index.ts');
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item).toContainText('index.ts');
    await expect(item).toContainText('@');
  });

  test('clicking the Session row opens the file as a workspace editor tab', async () => {
    const { page } = app;
    await ensureSessionCard(page);
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
    await ensureSessionCard(page);
    const empty = page.getByTestId('session-panel-skills-empty');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText('No skills used');
    await expect(page.locator('[data-testid^="session-panel-skill-/"]')).toHaveCount(0);
    await expect(page.getByTestId('session-panel-skills-manage')).toBeVisible();
  });

  test('attachment tiles render; the image tile opens the lightbox', async () => {
    const { page } = app;
    await ensureSessionCard(page);
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
    await ensureSessionCard(page);
    await page.getByTestId(`session-panel-attachment-${fileAttachmentId}`).click();
    await expect(page.getByTestId('image-lightbox-dialog')).toHaveCount(0);
  });

  test('collapsing the section hides every sub-group; expanding restores them', async () => {
    const { page } = app;
    await ensureSessionCard(page);
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
