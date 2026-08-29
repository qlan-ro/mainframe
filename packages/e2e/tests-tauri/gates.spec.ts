/**
 * §gates — Interactive gate details beyond chat.spec's happy paths.
 *
 * chat.spec.ts already covers: permission deny/allow-once/always-allow happy paths, plan
 * approve + keep-planning revision, and the single-question ask-question submit flow. This
 * spec covers the REST of the gate surface: the permission details disclosure, the
 * ask-question wizard's "Other…" free-text + Skip affordances, and the plan gate's exec-mode
 * segmented control + clear-context checkbox.
 *
 * All tests run in E2E_MODE=mock against the recordings in fixtures/recordings/. Replay is
 * positional/content-agnostic (see mainframe-adapter-mock/README.md) — the mock does not branch on
 * what a response contains, only on call order — so selecting "Other…"/a different exec mode
 * than what was recorded is safe; the recording only dictates which events fire next.
 *
 * Testid reference (new beyond chat.spec's list):
 *   chat-permission-details-toggle    — "Details" disclosure trigger on the permission gate
 *   chat-permission-details-pre       — raw JSON.stringify(request.input), shown when open
 *   chat-question-option-{q}-__other__ — the "Other…" option row for question index q
 *   chat-question-other-input-{q}     — free-text input, shown once "Other…" is selected
 *   chat-question-back / -next        — wizard pagination (multi-question only)
 *   chat-plan-execmode-{default|acceptEdits|yolo} — plan gate exec-mode segmented control
 *   chat-plan-clear-context           — plan gate "Clear context" checkbox
 *   chat-gate-card                    — the shared gate card shell (width parity against chat-composer)
 *   chat-thread-gate-slot             — the pinned, internally-scrolling slot the gate mounts in (#336)
 *   chat-thread-footer                — the sticky footer's inner wrapper (gate slot + banner + composer)
 *   find-bar                          — the in-chat Cmd/Ctrl+F bar, in flow above the scrolling viewport
 */

import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

// Minimal 1x1 red PNG — valid image, tiny payload (mirrors composer.spec.ts's fixture).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/** The gate card and the composer sit in two wrappers with identical geometry
 *  (`mx-auto w-full max-w-[min(48rem,100%-116px)] px-5`), so their outer edges must coincide. */
async function expectGateMatchesComposerWidth(page: Page) {
  const gate = await page.getByTestId('chat-gate-card').boundingBox();
  const composer = await page.getByTestId('chat-composer').boundingBox();
  expect(gate, 'gate card must be mounted').not.toBeNull();
  expect(composer, 'composer must be mounted').not.toBeNull();
  expect(Math.abs(gate!.x - composer!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(gate!.x + gate!.width - (composer!.x + composer!.width))).toBeLessThanOrEqual(1);
}

/** Mirrors transcript.spec.ts's `scrollViewportToTop` recipe (not exported there). */
async function scrollViewportToTop(page: Page): Promise<void> {
  await page.getByTestId('chat-thread-viewport').evaluate((el) => {
    el.scrollTop = 0;
  });
}

async function scrollViewportToBottom(page: Page): Promise<void> {
  await page.getByTestId('chat-thread-viewport').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
}

/**
 * The three invariants a pending gate and the composer must hold together,
 * at every scroll position: (a) the gate slot keeps a readable floor rather
 * than collapsing under the composer's competing demand — `min-h-24` (96px)
 * in ChatGateMount.tsx, a few px of tolerance for border/rounding; (b) the
 * composer's bottom edge stays inside the scrollport, not just the window;
 * (c) some transcript stays visible above the footer — the cap reserves a
 * fixed strip rather than letting the footer cover the whole pane (#336).
 */
async function assertGateFooterInvariants(page: Page): Promise<void> {
  const pane = await page.getByTestId('chat-thread-viewport').boundingBox();
  const footer = await page.getByTestId('chat-thread-footer').boundingBox();
  const composer = await page.getByTestId('chat-composer').boundingBox();
  const slot = await page.getByTestId('chat-thread-gate-slot').boundingBox();
  expect(pane, 'thread viewport must be mounted').not.toBeNull();
  expect(footer, 'footer must be mounted').not.toBeNull();
  expect(composer, 'composer must be mounted').not.toBeNull();
  expect(slot, 'gate slot must be mounted').not.toBeNull();

  expect(composer!.y + composer!.height).toBeLessThanOrEqual(pane!.y + pane!.height + 1);
  expect(slot!.height).toBeGreaterThanOrEqual(90);
  expect(footer!.y).toBeGreaterThan(pane!.y);
}

// ─── Permission gate — details disclosure + always-allow visibility ──────────

test.describe('§permission gate details', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'permissions-interactive' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('Details toggle reveals the raw tool input; the offered options render; the card matches the composer width at both surface widths', async () => {
    const { page } = app;
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });
    await expectGateMatchesComposerWidth(page);

    // Raw input pre is not mounted until the disclosure is opened.
    await expect(page.locator('[data-testid="chat-permission-details-pre"]')).toBeHidden();

    await page.locator('[data-testid="chat-permission-details-toggle"]').click();
    const pre = page.locator('[data-testid="chat-permission-details-pre"]');
    await expect(pre).toBeVisible({ timeout: 5_000 });
    // Recording's onPermission input: {"file_path":"/tmp/mf-e2e-test.txt","content":"hello"}
    await expect(pre).toContainText('/tmp/mf-e2e-test.txt');
    await expect(pre).toContainText('hello');

    // The daemon offers the same three options on every gate (spec decision 12) —
    // always-allow is no longer gated on the request carrying suggestions.
    await expect(page.locator('[data-testid="chat-permission-option-allow-always"]')).toBeVisible();

    // Narrow surface: lighting the workspace alongside chat shrinks the column in the same window.
    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 10_000 });
    await expectGateMatchesComposerWidth(page);
    const column = await page.getByTestId('chat-thread-footer').boundingBox();
    const narrowGate = await page.getByTestId('chat-gate-card').boundingBox();
    expect(narrowGate!.width).toBeLessThanOrEqual(column!.width);
    await page.getByTestId('surface-rail-workspace').click();

    // Clean up: deny so the AI finishes.
    await page.locator('[data-testid="chat-permission-option-reject-once"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Permission gate — the offered option set is suggestion-independent ──────

test.describe('§permission gate no suggestions', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'permissions-no-suggestions' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // The pre-facade gate hid Always Allow when the request carried no suggestions
  // (client-side `hasSuggestions` gating). On the facade the daemon supplies the
  // option list and the client renders it verbatim (spec decision 12) — the
  // recording's empty `suggestions:[]` must NOT change the offered set.
  test('all three offered options render even when the request carries no suggestions', async () => {
    const { page } = app;
    await sendMessage(page, 'Run `whoami` to check the current user');
    const gate = page.locator('[data-testid="chat-permission-gate"]');
    await gate.waitFor({ timeout: 45_000 });

    await expect(page.locator('[data-testid="chat-permission-option-allow-once"]')).toBeVisible();
    await expect(page.locator('[data-testid="chat-permission-option-allow-always"]')).toBeVisible();
    await expect(page.locator('[data-testid="chat-permission-option-reject-once"]')).toBeVisible();

    await page.locator('[data-testid="chat-permission-option-reject-once"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Ask-question wizard — Other… free-text + Skip ────────────────────────────

test.describe('§ask-question wizard extras', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'ask-question' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'yolo');
  });

  test.afterAll(async () => {
    // Mirrors chat.spec's §ask-question teardown ordering: stop the daemon before removing the
    // project dir (the recording's final fx event fires async, shortly after onResult).
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('"Other…" reveals a free-text input; Skip dismisses the gate without an answer', async () => {
    const { page } = app;
    await sendMessage(page, 'Use AskUserQuestion to ask me a single-select question with 2 options');

    await page.locator('[data-testid="chat-question-gate"]').waitFor({ timeout: 60_000 });
    await expectGateMatchesComposerWidth(page);

    // Other-input is not mounted until "Other…" is selected.
    await expect(page.locator('[data-testid="chat-question-other-input-0"]')).toBeHidden();

    await page.locator('[data-testid="chat-question-option-0-__other__"]').click();
    const otherInput = page.locator('[data-testid="chat-question-other-input-0"]');
    await expect(otherInput).toBeVisible({ timeout: 5_000 });
    await otherInput.fill('A custom free-text answer');
    await expect(otherInput).toHaveValue('A custom free-text answer');

    // Selecting "Other…" satisfies isQuestionAnswered, so Submit would be enabled too — but this
    // test exercises Skip (submit-with-a-chosen-option is already covered by chat.spec).
    await page.locator('[data-testid="chat-question-skip"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Ask-question wizard — multi-question pagination + multi-select ─────────

test.describe('§ask-question wizard multi-question', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'ask-question-multi' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'yolo');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  // The recording's single AskUserQuestion carries both a single-select Q1 ("Auth method") and a
  // multiSelect Q2 ("Target environments") on one gate instance, so pagination and the multiSelect
  // Checkbox branch are two facets of the same continuous wizard flow — asserted together here
  // rather than split across two sessions (only one ask-question-multi recording exists).
  test('Next/Back paginate with a "N of M" counter; the multi-select question renders checkboxes and allows toggling more than one option', async () => {
    const { page } = app;
    await sendMessage(
      page,
      'Use AskUserQuestion to ask two questions: single-select auth method, then multi-select target environments',
    );

    const gate = page.locator('[data-testid="chat-question-gate"]');
    await gate.waitFor({ timeout: 60_000 });
    await expect(gate).toContainText('1 of 2');

    // Q1 is single-select: Next is disabled until an option is chosen.
    const next = page.locator('[data-testid="chat-question-next"]');
    await expect(next).toBeDisabled();
    await page.locator('[data-testid="chat-question-option-0-API key"]').click();
    await expect(next).toBeEnabled();

    await next.click();
    await expect(gate).toContainText('2 of 2');
    await expect(page.locator('[data-testid="chat-question-back"]')).toBeVisible();

    // Q2 is multiSelect — OptionRow renders a Checkbox (role=checkbox), not the radio indicator.
    // The Checkbox is `aria-hidden="true"` + `pointer-events-none` (AskQuestionWizard.tsx — the
    // outer `role="button"` OptionRow div is the real interactive/accessible element, the inner
    // Checkbox is purely decorative so screen readers aren't double-announced). That means
    // `getByRole('checkbox')` (accessibility-tree-based) can never find it — live-verified: it
    // times out even though the checkbox renders correctly. Query the literal DOM `role`
    // attribute instead (Radix's `CheckboxPrimitive.Root` sets `role="checkbox"` as a real DOM
    // attribute regardless of `aria-hidden`), which is what this test actually needs to assert.
    const staging = page.locator('[data-testid="chat-question-option-1-Staging"]');
    const production = page.locator('[data-testid="chat-question-option-1-Production"]');
    await expect(staging.locator('[role="checkbox"]')).toBeVisible();

    await staging.click();
    await expect(staging.locator('[role="checkbox"]')).toHaveAttribute('data-state', 'checked');
    await production.click();
    // Toggling a second option does not clear the first (multiSelect, unlike the Q1 radio branch).
    await expect(staging.locator('[role="checkbox"]')).toHaveAttribute('data-state', 'checked');
    await expect(production.locator('[role="checkbox"]')).toHaveAttribute('data-state', 'checked');

    // Back returns to Q1 with its selection preserved.
    await page.locator('[data-testid="chat-question-back"]').click();
    await expect(gate).toContainText('1 of 2');
    await expect(next).toBeEnabled();

    await next.click();
    await expect(gate).toContainText('2 of 2');
    await page.locator('[data-testid="chat-question-submit"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Plan gate — exec-mode segmented control + clear-context ─────────────────

test.describe('§plan gate exec-mode', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'plan-approval' });
    project = await createTauriProject(app.page, {
      claudeMd:
        '# E2E Test Project\n\nThis is an automated test environment.\n' +
        'In plan mode, proceed with reasonable assumptions. Do not use AskUserQuestion. ' +
        'Call ExitPlanMode immediately after reading the relevant files.\n',
    });
    await createTauriChat(app.page, project.projectId, 'plan');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // Approving unmounts the gate entirely (todo #296 — see ChatGateMount: an answered gate just
  // returns null) so there is no post-approve state left on the gate itself to assert. Under
  // E2E_MODE=mock the chat runs on `mock-cli`, which exposes no plan-mode handler, so an approval
  // with `clearContext` never reaches `ClaudePlanModeHandler`. The post-approve surface is covered
  // by tool-cards.spec.ts's "§tool-cards — Plan (plan-approval)" describe (its approved-PlanBubble
  // test) and T12's live run. Named, not line-numbered — the previous `tool-cards.spec.ts:363-372`
  // pointer went stale the moment that file's header changed length.
  test('selecting Unattended + clear-context marks both controls selected', async () => {
    const { page } = app;
    await sendMessage(page, 'Add `export function greet(name: string) { return "Hello " + name; }` to utils.ts');
    await page.locator('[data-testid="chat-plan-gate"]').waitFor({ timeout: 45_000 });
    await expectGateMatchesComposerWidth(page);

    await page.locator('[data-testid="chat-plan-execmode-yolo"]').click();
    await expect(page.locator('[data-testid="chat-plan-execmode-yolo"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="chat-plan-execmode-default"]')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('[data-testid="chat-plan-clear-context"]').click();
    await expect(page.locator('[data-testid="chat-plan-clear-context"]')).toHaveAttribute('data-state', 'checked');
  });
});

// ─── Gate queue — one-gate-at-a-time ──────────────────────────────────────────

test.describe('§gate queue-front', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'permissions-stacked' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // The daemon architecturally serializes stacked control_requests to the client — it never
  // delivers two simultaneously (permission-manager enqueues the 2nd server-side and only raises
  // its `session/request_permission` after the 1st is resolved). So the observable, reachable behavior
  // per select-front.ts's queue-front design is: exactly one gate is mounted at a time, tool 1's
  // gate resolves first, then tool 2's gate appears — in recorded order. That is what this test
  // asserts (see .superpowers/sdd/reports/recordings-author-report.md's permissions-stacked notes
  // for why literal DOM-level simultaneity isn't a reachable state to assert).
  test('only one gate is mounted at a time; tool 1 resolves before tool 2 appears, in recorded order', async () => {
    const { page } = app;
    await sendMessage(page, 'Write /tmp/mf-e2e-stacked.txt then run `ls -la /tmp` to confirm it');

    const gate = page.locator('[data-testid="chat-permission-gate"]');
    await gate.waitFor({ timeout: 45_000 });
    await expect(gate).toContainText('Write');
    await expect(gate).toHaveCount(1);

    await page.locator('[data-testid="chat-permission-option-allow-once"]').click();

    // Tool 2's gate only mounts after tool 1's is answered — same testid, new content.
    await expect(gate).toContainText('Bash', { timeout: 10_000 });
    await expect(gate).toHaveCount(1);

    await page.locator('[data-testid="chat-permission-option-reject-once"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Gate — pinned slot stays reachable while the transcript scrolls ─────────

test.describe('§gate pinned slot', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'permissions-stacked' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
    // The Tauri window's minimum is 800x600 (tauri.conf.json) — 1200x600 is the
    // shortest window that still forces a one-turn transcript to overflow.
    await app.page.setViewportSize({ width: 1200, height: 600 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // Also covers the incidental parity assertion in "§permission gate details" above —
  // its second `expectGateMatchesComposerWidth` call, with Details expanded and the
  // workspace open, already exercises the same scrollbar-suppression contract this
  // test verifies deliberately. Intended overlap, not redundant — keep both. Named,
  // not line-numbered (this file's own plan-gate describe explains why).
  test('the gate is mounted in the pinned footer slot, stays visible while the transcript is scrolled away, and keeps composer width parity while the slot itself scrolls', async () => {
    const { page } = app;
    await sendMessage(page, 'Write /tmp/mf-e2e-stacked.txt then run `ls -la /tmp` to confirm it');

    const gate = page.locator('[data-testid="chat-permission-gate"]');
    await gate.waitFor({ timeout: 45_000 });

    // The card mounts inside the pinned slot, which itself lives in the sticky footer —
    // not inline in the scrolling transcript column.
    const slot = page.getByTestId('chat-thread-gate-slot');
    await expect(slot.locator('[data-testid="chat-permission-gate"]')).toBeVisible();
    const slotInFooter = await slot.evaluate((el) => el.closest('[data-testid="chat-thread-footer"]') !== null);
    expect(slotInFooter).toBe(true);

    // Precondition, asserted not assumed: the recorded turn must actually overflow the
    // viewport at this window size, or the scroll-away check below passes vacuously.
    const overflowsBeforeExpand = await page
      .getByTestId('chat-thread-viewport')
      .evaluate((el) => el.scrollHeight - el.clientHeight > 8);
    expect(overflowsBeforeExpand).toBe(true);

    // Collapsed card: the slot does not overflow yet. Scroll the transcript to the top —
    // the gate must stay put, fully visible, and the scroll position must not get pulled
    // back down to it.
    await scrollViewportToTop(page);
    await expect(gate).toBeInViewport();
    await expect(page.locator('[data-testid="chat-permission-option-allow-once"]')).toBeInViewport();
    await expect(page.locator('[data-testid="chat-permission-option-allow-once"]')).toBeEnabled();
    await page.waitForTimeout(300);
    const scrollTopAfterSettle = await page.getByTestId('chat-thread-viewport').evaluate((el) => el.scrollTop);
    expect(scrollTopAfterSettle).toBe(0);

    // Force the slot itself to overflow (Decisions: `[scrollbar-width:none]` suppression is
    // the load-bearing bit for width parity once this happens) and re-check parity.
    await page.locator('[data-testid="chat-permission-details-toggle"]').click();
    await page.locator('[data-testid="chat-permission-details-pre"]').waitFor({ timeout: 5_000 });
    const slotOverflows = await slot.evaluate((el) => el.scrollHeight - el.clientHeight > 0);
    expect(slotOverflows).toBe(true);
    await expectGateMatchesComposerWidth(page);

    // Drain the queue (this recording raises a second, Bash gate) and leave idle.
    await page.locator('[data-testid="chat-permission-option-allow-once"]').click();
    await expect(gate).toContainText('Bash', { timeout: 10_000 });
    await page.locator('[data-testid="chat-permission-option-reject-once"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Gate — a tall queued draft never starves the slot or clips the composer ─

test.describe('§gate slot cap under a tall composer draft', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let testImagePath: string;

  test.beforeAll(async () => {
    // `permissions-stacked`, not `permissions-no-suggestions`: its non-empty
    // `suggestions` render the "Always Allow" row, which is what actually
    // pushes the collapsed card — and, once Details is open, the slot itself
    // — past the 45cqh cap at this window size. `§gate pinned slot` above
    // already proves that overflow on this exact recording; reusing it here
    // means the "gate at its cap" precondition below is backed by a passing
    // sibling assertion, not a guess.
    app = await launchTauriApp({ recordingKey: 'permissions-stacked' });
    project = await createTauriProject(app.page);
    testImagePath = path.join(project.projectPath, 'test-image.png');
    writeFileSync(testImagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
    await createTauriChat(app.page, project.projectId, 'default');
    // The Tauri window's minimum is 800x600 (tauri.conf.json) — 1200x600 is the
    // shortest window that still forces the footer's two blocks to compete for space.
    await app.page.setViewportSize({ width: 1200, height: 600 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // Regression guard for a round-3 review finding: the round-2 fix bounded the
  // footer against the wrong box (`ThreadPrimitive.Root`, which also contains
  // the in-flow `FindBar`) and left the footer's cap at a bare 100%, so an
  // expanded gate plus a tall draft could occlude the transcript entirely, or
  // — once the two rigid minimums (the slot's `min-h-24` floor and the
  // composer's `shrink-0` wrapper) summed past a short pane — push the
  // composer past the pane outright. This test drives BOTH blocks toward
  // their caps at once (Details expanded on the gate, a tall queued draft
  // plus an attachment on the composer) and checks all three invariants at
  // BOTH scroll ends, because a sticky box taller than its scrollport pins to
  // the TOP and overflows past the bottom — a failure the original guard,
  // which only checked scroll-top, could still miss.
  test('an expanded gate at its cap and a tall queued draft compete for the footer without occluding the transcript or pushing the composer past the pane', async () => {
    const { page } = app;
    await sendMessage(page, 'Write /tmp/mf-e2e-stacked.txt then run `ls -la /tmp` to confirm it');

    const gate = page.locator('[data-testid="chat-permission-gate"]');
    await gate.waitFor({ timeout: 45_000 });

    // Collapsed-and-uncontested phase, before either block is driven toward its cap:
    // the action row is reachable in place. Asserted here, not after the squeeze below —
    // an expanded gate at floor height can legitimately push its own action row below
    // the slot's internal scroll fold, which is a different contract (internal
    // scrolling) than this test is guarding.
    const allowOnce = page.locator('[data-testid="chat-permission-option-allow-once"]');
    await expect(allowOnce).toBeInViewport();
    await expect(allowOnce).toBeEnabled();

    // Drive the gate to its cap: expand Details.
    await page.locator('[data-testid="chat-permission-details-toggle"]').click();
    await page.locator('[data-testid="chat-permission-details-pre"]').waitFor({ timeout: 5_000 });

    // Drive the composer toward its own natural size with a multi-line queued draft
    // plus an attachment tile row.
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('composer-add-attachment').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);
    await page.locator('[data-testid="composer-attachment-tile"]').waitFor({ timeout: 5_000 });

    const tallDraft = Array.from({ length: 15 }, (_, i) => `Queued draft line ${i + 1} of a long message.`).join('\n');
    await page.getByTestId('chat-composer-input').fill(tallDraft);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue(tallDraft);

    // Preconditions, asserted not assumed — the fix lets the composer shrink under
    // pressure, so its rendered height is no longer a reliable "did this actually
    // squeeze" probe (round-3 finding #4: the old `>260` threshold sat comfortably
    // under the break-even it meant to guard). Assert the SOURCE of the pressure
    // instead: the viewport overflows, and the slot itself — not just the card —
    // is scrolling, which is what "the gate is at its cap" means operationally.
    const overflowsViewport = await page
      .getByTestId('chat-thread-viewport')
      .evaluate((el) => el.scrollHeight - el.clientHeight > 8);
    expect(overflowsViewport).toBe(true);
    const slot = page.getByTestId('chat-thread-gate-slot');
    const slotOverflows = await slot.evaluate((el) => el.scrollHeight - el.clientHeight > 0);
    expect(slotOverflows).toBe(true);

    // The failure this guards against is scroll-position-specific (sticky-bottom's
    // top-pin-and-overflow behavior only shows at scroll-top), so check both ends.
    await scrollViewportToTop(page);
    await assertGateFooterInvariants(page);
    await scrollViewportToBottom(page);
    await assertGateFooterInvariants(page);

    // Drain the queue (this recording raises a second, Bash gate) and leave idle.
    await page.locator('[data-testid="chat-permission-option-allow-once"]').click();
    await expect(gate).toContainText('Bash', { timeout: 10_000 });
    await page.locator('[data-testid="chat-permission-option-reject-once"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Gate — the footer cap references the scrollport, not the root ──────────

test.describe('§gate slot cap with the find bar open', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let testImagePath: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'permissions-stacked' });
    project = await createTauriProject(app.page);
    testImagePath = path.join(project.projectPath, 'test-image.png');
    writeFileSync(testImagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
    await createTauriChat(app.page, project.projectId, 'default');
    await app.page.setViewportSize({ width: 1200, height: 600 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // Regression guard for round-3 finding #2: the footer's `max-h` used to be a
  // container-query length against `ThreadPrimitive.Root`, whose `[container-type:size]`
  // also covers the in-flow `FindBar` above the scrolling viewport — a root-relative cap
  // over-counts the pane by the find bar's height, so a footer sized against it can render
  // taller than the actual scrollport once find is open. The 800x600 Tauri minimum (fact 10)
  // leaves too little headroom for a "plain draft, nothing else" regime to cross that gap —
  // the same compound pressure as the sibling test (gate at cap, attachment, tall draft) is
  // needed to push the footer's natural size close enough to the pane that the find bar's
  // ~30px makes the difference between fitting and not.
  test('the same compound squeeze still holds once the find bar takes its own row out of the pane', async () => {
    const { page } = app;
    await sendMessage(page, 'Write /tmp/mf-e2e-stacked.txt then run `ls -la /tmp` to confirm it');

    const gate = page.locator('[data-testid="chat-permission-gate"]');
    await gate.waitFor({ timeout: 45_000 });

    await page.keyboard.press('ControlOrMeta+f');
    await expect(page.getByTestId('find-bar')).toBeVisible({ timeout: 5_000 });

    await page.locator('[data-testid="chat-permission-details-toggle"]').click();
    await page.locator('[data-testid="chat-permission-details-pre"]').waitFor({ timeout: 5_000 });

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('composer-add-attachment').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);
    await page.locator('[data-testid="composer-attachment-tile"]').waitFor({ timeout: 5_000 });

    const tallDraft = Array.from({ length: 15 }, (_, i) => `Queued draft line ${i + 1} of a long message.`).join('\n');
    await page.getByTestId('chat-composer-input').fill(tallDraft);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue(tallDraft);

    // Preconditions — see the sibling test's comment for why a composer-height threshold
    // is the wrong probe under the fix; assert the source of the pressure instead.
    const overflowsViewport = await page
      .getByTestId('chat-thread-viewport')
      .evaluate((el) => el.scrollHeight - el.clientHeight > 8);
    expect(overflowsViewport).toBe(true);
    const slotOverflows = await page
      .getByTestId('chat-thread-gate-slot')
      .evaluate((el) => el.scrollHeight - el.clientHeight > 0);
    expect(slotOverflows).toBe(true);

    await scrollViewportToTop(page);
    await assertGateFooterInvariants(page);
    await scrollViewportToBottom(page);
    await assertGateFooterInvariants(page);

    await page.locator('[data-testid="chat-permission-option-allow-once"]').click();
    await expect(gate).toContainText('Bash', { timeout: 10_000 });
    await page.locator('[data-testid="chat-permission-option-reject-once"]').click();
    await waitForIdle(page, 60_000);
  });
});
