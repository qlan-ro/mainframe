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
 * positional/content-agnostic (see plugins/mock-cli/DESIGN.md) — the mock does not branch on
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

  // TODO(recording): needs `permissions-no-suggestions` — a recorded onPermission with
  // suggestions:[] (e.g. a tool request that isn't eligible for a persistent-permission
  // suggestion). Every existing permission recording (permissions-interactive, plan-approval)
  // carries non-empty suggestions, so the "always-allow absent" branch has no fixture today.
  test.skip('always-allow is absent when the request carries no suggestions', async () => {
    // TODO(recording): needs permissions-no-suggestions
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

  // TODO(recording): needs `ask-question-multi` — a recorded AskUserQuestion input.questions
  // with 2+ entries (so `chat-question-next`/`-back` and the "N of M" counter badge render;
  // today's only ask-question recording carries a single question).
  test.skip('multi-question wizard: Next/Back paginate and the "N of M" counter updates', async () => {
    // TODO(recording): needs ask-question-multi
  });

  // TODO(recording): needs a question with multiSelect:true (can be folded into
  // ask-question-multi above, or a dedicated single-question multiSelect recording) — today's
  // only recording has multiSelect:false, so OptionRow always renders the radio indicator, never
  // the Checkbox branch.
  test.skip('multi-select question renders checkboxes and allows toggling more than one option', async () => {
    // TODO(recording): needs ask-question-multiselect
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

  test('selecting Unattended + clear-context and approving shows a matching running footer', async () => {
    const { page } = app;
    await sendMessage(page, 'Add `export function greet(name: string) { return "Hello " + name; }` to utils.ts');
    await page.locator('[data-testid="chat-plan-gate"]').waitFor({ timeout: 45_000 });

    await page.locator('[data-testid="chat-plan-execmode-yolo"]').click();
    await page.locator('[data-testid="chat-plan-clear-context"]').click();
    await page.locator('[data-testid="chat-plan-approve"]').click();

    // The running footer's text is derived from local execMode/clearContext React state (not the
    // mock's replayed content), so this is a real assertion of the control's effect, not a
    // duplicate of chat.spec's plan-approve happy path.
    const footer = page.locator('[data-testid="chat-plan-running-footer"]');
    await expect(footer).toBeVisible({ timeout: 5_000 });
    await expect(footer).toContainText('Unattended');
    await expect(footer).toContainText('context cleared');

    // Approval triggers Claude to execute → an Edit permission gate follows (plan-approval.0.ndjson).
    // Deny it so the mock session ends cleanly.
    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });
    await page.locator('[data-testid="chat-permission-deny"]').click();
    await waitForIdle(page, 90_000);
  });
});

// ─── Gate queue — one-gate-at-a-time (live-only, no recording) ───────────────

test.describe('§gate queue-front (needs stacked recording)', () => {
  // TODO(recording): needs `permissions-stacked` — two onPermission `out` events fired back to
  // back with no `in` marker (i.e. no respondToPermission) between them, reproducing the CLI
  // firing multiple control_requests per API turn (see memory
  // permission-queue-multi-control-request). No existing recording stacks control_requests —
  // verified by scanning every fixture in packages/e2e/fixtures/recordings/ for two consecutive
  // `out`/`onPermission` events uninterrupted by an `in` marker; none do. select-front.ts's
  // askedAt-ascending queue-front behavior (ChatGateMount renders only the earliest-asked entry)
  // needs that shape to exercise.
  test.skip('only the earliest-asked gate mounts when the CLI stacks multiple control_requests', async () => {
    // TODO(recording): needs permissions-stacked
  });
});
