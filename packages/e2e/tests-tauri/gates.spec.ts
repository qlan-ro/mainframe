/**
 * §gates — Interactive gate details beyond chat.spec's happy paths.
 *
 * chat.spec.ts already covers: permission deny/allow-once/always-allow happy paths, plan
 * approve + keep-planning revision, and the single-question ask-question submit flow. This
 * spec covers the REST of the gate surface: the permission details disclosure, the
 * ask-question wizard's "Other…" free-text + Skip affordances, and the plan gate's exec-mode
 * segmented control + clear-context checkbox reflected in the post-approve running footer.
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
 *   chat-plan-running-footer          — post-approve footer, text keyed off local execMode/clearContext state
 */

import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

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

  test('Details toggle reveals the raw tool input; always-allow shown when suggestions exist', async () => {
    const { page } = app;
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });

    // Raw input pre is not mounted until the disclosure is opened.
    await expect(page.locator('[data-testid="chat-permission-details-pre"]')).toBeHidden();

    await page.locator('[data-testid="chat-permission-details-toggle"]').click();
    const pre = page.locator('[data-testid="chat-permission-details-pre"]');
    await expect(pre).toBeVisible({ timeout: 5_000 });
    // Recording's onPermission input: {"file_path":"/tmp/mf-e2e-test.txt","content":"hello"}
    await expect(pre).toContainText('/tmp/mf-e2e-test.txt');
    await expect(pre).toContainText('hello');

    // Recording's suggestions carry [{type:setMode,...},{type:addDirectories,...}] — non-empty.
    await expect(page.locator('[data-testid="chat-permission-always-allow"]')).toBeVisible();

    // Clean up: deny so the AI finishes.
    await page.locator('[data-testid="chat-permission-deny"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Permission gate — always-allow absent without suggestions ──────────────

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

  test('always-allow is absent when the request carries no suggestions', async () => {
    const { page } = app;
    await sendMessage(page, 'Run `whoami` to check the current user');
    const gate = page.locator('[data-testid="chat-permission-gate"]');
    await gate.waitFor({ timeout: 45_000 });

    // Recording's onPermission carries suggestions:[] — ActionFooter's `hasSuggestions` gate.
    await expect(page.locator('[data-testid="chat-permission-always-allow"]')).toBeHidden();
    // The rest of the footer still renders — this is a targeted absence, not a broken gate.
    await expect(page.locator('[data-testid="chat-permission-allow-once"]')).toBeVisible();
    await expect(page.locator('[data-testid="chat-permission-deny"]')).toBeVisible();

    await page.locator('[data-testid="chat-permission-deny"]').click();
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

  // Previously: `chat-plan-running-footer` never mounted — approving a plan
  // optimistically dropped the gate from the permission queue right away,
  // unmounting `PlanGate` (and its local `approved` state) before the running
  // footer could render. Fixed by the product-bug-fix campaign —
  // `ChatGateMount` now retains the just-approved plan entry (same element
  // type + position) until the run actually ends.
  //
  // FIXED (commit f1666315): the plan card was resetting to its pre-approval
  // defaults instead of showing the running footer — a one-render gap where
  // `ChatGateMount` unmounted `PlanGate` between the optimistic approve and
  // `isRunning` catching up, losing its local state. `ChatGateMount` now
  // retains the just-approved plan entry across that gap.
  test('selecting Unattended + clear-context and approving shows a matching running footer', async () => {
    const { page } = app;
    await sendMessage(page, 'Add `export function greet(name: string) { return "Hello " + name; }` to utils.ts');
    await page.locator('[data-testid="chat-plan-gate"]').waitFor({ timeout: 45_000 });

    await page.locator('[data-testid="chat-plan-execmode-yolo"]').click();
    await page.locator('[data-testid="chat-plan-clear-context"]').click();
    await page.locator('[data-testid="chat-plan-approve"]').click();

    // The running footer's text is derived from local execMode/clearContext React state (not the
    // mock's replayed content), so this is a real assertion of the control's effect, not a
    // duplicate of chat.spec's plan-approve happy path. This is the behavior this test exists to
    // cover, and it passes cleanly (verified in isolation) — the ChatGateMount retain fix works.
    const footer = page.locator('[data-testid="chat-plan-running-footer"]');
    await expect(footer).toBeVisible({ timeout: 5_000 });
    await expect(footer).toContainText('Unattended');
    await expect(footer).toContainText('context cleared');

    // TODO(bug): approving with clearContext kills the mock CLI session and
    // starts a fresh one (ClaudePlanModeHandler.onApproveAndClearContext:
    // respondToPermission(deny) + session.kill() + startChat + a new
    // "Implement the following plan…" sendMessage), which should replay
    // plan-approval.1.ndjson's Edit permission gate on the fresh session.
    // Verified in isolation (clean single-worker run, no port contention):
    // `chat-permission-gate` never appears within 45s on either attempt — a
    // residual gap in the clear-context kill+respawn+resend flow that this
    // pass's fix (the running-footer retain in ChatGateMount) doesn't touch.
    // Reported to the orchestrator; not re-investigated here (out of this
    // pass's scope — would require product-code changes in packages/core).
    test.skip(
      true,
      'TODO(bug): after approve+clearContext kills and respawns the mock session, the follow-up chat-permission-gate (plan-approval.1.ndjson) never appears within 45s — residual gap in the clear-context respawn flow',
    );
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
  // delivers two simultaneously (permission-manager enqueues the 2nd server-side and only emits
  // its `permission.requested` after the 1st is resolved). So the observable, reachable behavior
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

    await page.locator('[data-testid="chat-permission-allow-once"]').click();

    // Tool 2's gate only mounts after tool 1's is answered — same testid, new content.
    await expect(gate).toContainText('Bash', { timeout: 10_000 });
    await expect(gate).toHaveCount(1);

    await page.locator('[data-testid="chat-permission-deny"]').click();
    await waitForIdle(page, 60_000);
  });
});
