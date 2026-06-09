/**
 * §chat — Messaging + interactive gate (permission / plan / ask-question) specs.
 *
 * Ported from packages/e2e/tests/{05,06,07,08}-*.spec.ts to the app-tauri browser harness.
 * All tests run in E2E_MODE=mock against the recordings in fixtures/recordings/.
 *
 * Testid reference:
 *   chat-thread-running          — present while AI is working; absent/hidden when idle
 *   chat-user-message            — user turn bubble
 *   chat-assistant-message       — assistant reply bubble
 *   chat-bash-card               — rendered Bash tool card
 *   chat-permission-gate         — permission gate container
 *   chat-permission-deny         — deny button
 *   chat-permission-allow-once   — allow-once button
 *   chat-permission-always-allow — always-allow button (only when suggestions present)
 *   chat-plan-gate               — plan gate container
 *   chat-plan-approve            — approve & run button
 *   chat-plan-keep-planning      — "Keep planning" → opens ReviseRow
 *   chat-plan-reject             — reject button
 *   chat-plan-feedback-input     — feedback textarea (only visible after keep-planning)
 *   chat-plan-send-feedback      — send-feedback button
 *   chat-plan-revise-cancel      — cancel revision button
 *   chat-question-gate           — AskUserQuestion interactive gate container
 *   chat-question-submit         — submit button (disabled until an option is chosen)
 *   chat-question-skip           — skip button
 *   chat-question-option-{q}-{label} — per-option button (q = question index)
 */

import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

// ─── §5 Messaging ─────────────────────────────────────────────────────────────

test.describe('§messaging', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('sends a message and receives a text response', async () => {
    const { page } = app;
    await sendMessage(page, 'What is 2 + 2? Reply with just the number.');
    await waitForIdle(page, 60_000);
    await expect(page.locator('[data-testid="chat-assistant-message"]').first()).toBeVisible();
    await expect(page.getByText('4', { exact: true }).first()).toBeVisible();
  });

  // TODO(app-tauri): no turn-footer token-count testid exists in app-tauri
  test.skip('turn footer shows token count after response', async () => {
    // `turn-footer` / `turn-footer-tokens` is not ported to app-tauri
  });

  test('AI can invoke a bash tool to list files', async () => {
    const { page } = app;
    await sendMessage(page, 'List the files in this project using bash ls.');
    await waitForIdle(page, 90_000);
    // Recording: the AI calls Bash("ls -la"). BashCard renders with data-testid="chat-bash-card".
    await expect(page.locator('[data-testid="chat-bash-card"]').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ─── §6 Permissions — Interactive ─────────────────────────────────────────────

test.describe('§permissions interactive', () => {
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

  test('shows permission gate for a file creation request', async () => {
    const { page } = app;
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });
    await expect(page.locator('[data-testid="chat-permission-gate"]')).toBeVisible();
  });

  test('Deny dismisses the gate and AI becomes idle', async () => {
    const { page } = app;
    await page.locator('[data-testid="chat-permission-deny"]').click();
    await waitForIdle(page, 60_000);
    await expect(page.locator('[data-testid="chat-thread-running"]')).toBeHidden();
  });

  test('Allow Once permits the tool; next identical request shows the gate again', async () => {
    const { page } = app;

    // First: allow-once
    await sendMessage(page, 'Create /tmp/mf-e2e-test.txt again');
    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });
    await page.locator('[data-testid="chat-permission-allow-once"]').click();
    await waitForIdle(page, 60_000);

    // Second: gate should appear again (allow-once does not persist)
    await sendMessage(page, 'Create /tmp/mf-e2e-test.txt one more time');
    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });
    await expect(page.locator('[data-testid="chat-permission-gate"]')).toBeVisible();

    // Clean up: deny so the AI finishes
    await page.locator('[data-testid="chat-permission-deny"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── §6 Permissions — Auto-Edits / Yolo (live-only, no recording) ─────────────

// TODO(app-tauri): live-only describes (auto-edits / yolo without recording) — skip in mock mode
test.describe('§permissions auto-edits (live only)', () => {
  test('file edits proceed without a gate (live only)', async () => {
    test.skip(true, 'TODO(app-tauri): live-only test, no recording; run with E2E_MODE=record');
  });
});

test.describe('§permissions yolo (live only)', () => {
  test('all tool permissions auto-approved in Yolo mode (live only)', async () => {
    test.skip(true, 'TODO(app-tauri): live-only test, no recording; run with E2E_MODE=record');
  });
});

// ─── §7 Plan approval ─────────────────────────────────────────────────────────

test.describe('§plan approval', () => {
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

  test('plan gate appears and can be approved → permission gate → always allow → idle', async () => {
    const { page } = app;
    await sendMessage(page, 'Add `export function greet(name: string) { return "Hello " + name; }` to utils.ts');
    // Plan gate: ExitPlanMode arrives as onPermission with toolName=ExitPlanMode
    await page.locator('[data-testid="chat-plan-gate"]').waitFor({ timeout: 45_000 });
    await expect(page.locator('[data-testid="chat-plan-gate"]')).toBeVisible();
    await page.locator('[data-testid="chat-plan-approve"]').click();

    // After approval, Claude executes → triggers an Edit permission gate
    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });
    // suggestions=[{type:setMode,...}] so always-allow button is present
    await page.locator('[data-testid="chat-permission-always-allow"]').click();
    await waitForIdle(page, 90_000);
  });

  // TODO(app-tauri): mid-test createTauriChat navigation race — after the first test completes,
  // calling createTauriChat() mid-test (not in beforeAll) causes the message to be delivered to
  // the previously-active chat instead of the new one. Root cause: after createTauriChat clicks
  // the new chat row and enables plan mode (firing chat.updated → runtime.threads.reload()), a
  // navigation event from the session list router reverts the active thread to the first chat
  // before sendMessage is called. Reproduces in the screenshot: "Add multiply..." message appears
  // inline in the "Add Greet Function" thread. Requires a dedicated daemon+describe per test or
  // a useSessionListRouter fix to avoid reverting active thread on reload.
  test('plan revision: keep-planning opens feedback input, send-feedback triggers a new plan gate', async () => {
    const { page } = app;
    // Uses plan-approval.1.ndjson (second session = index 1 within this daemon instance).
    await createTauriChat(app.page, project.projectId, 'plan');
    await sendMessage(page, 'Add `export function multiply(a: number, b: number) { return a * b; }` to utils.ts');
    await page.locator('[data-testid="chat-plan-gate"]').waitFor({ timeout: 45_000 });

    // "Keep planning" button sets revising=true and reveals ReviseRow
    await page.locator('[data-testid="chat-plan-keep-planning"]').click();
    await expect(page.locator('[data-testid="chat-plan-feedback-input"]')).toBeVisible({ timeout: 5_000 });

    // Fill feedback and send — mock recording replays a second plan gate
    await page.locator('[data-testid="chat-plan-feedback-input"]').fill('Please also add a divide function');
    await page.locator('[data-testid="chat-plan-send-feedback"]').click();

    // A new plan gate should appear for the revised plan
    await page.locator('[data-testid="chat-plan-gate"]').waitFor({ timeout: 45_000 });
    await expect(page.locator('[data-testid="chat-plan-gate"]')).toBeVisible();

    // Clean up: reject so the mock session ends cleanly
    await page.locator('[data-testid="chat-plan-reject"]').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── §8 AskUserQuestion ───────────────────────────────────────────────────────

test.describe('§ask-question', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'ask-question' });
    project = await createTauriProject(app.page);
    // Yolo mode so the AI can call AskUserQuestion immediately (no plan/permission interrupts)
    await createTauriChat(app.page, project.projectId, 'yolo');
  });

  test.afterAll(async () => {
    // Close the app (stops the daemon) BEFORE removing the project directory.
    // The ask-question recording's final fx event fires async (≤120ms after onResult); stopping
    // the daemon first ensures no more file writes are in-flight when rmSync runs.
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('question gate renders; submit disabled until option chosen; submit enabled after choice; submits', async () => {
    const { page } = app;
    await sendMessage(page, 'Use AskUserQuestion to ask me a single-select question with 2 options');

    // Gate appears
    await page.locator('[data-testid="chat-question-gate"]').waitFor({ timeout: 60_000 });
    await expect(page.locator('[data-testid="chat-question-gate"]')).toBeVisible();

    // Submit is disabled before any option is selected
    await expect(page.locator('[data-testid="chat-question-submit"]')).toBeDisabled();

    // The recording delivers: question index=0, options=[{label:"Work on index.ts",...},{label:"Focus on test setup",...}]
    // Option testids: chat-question-option-0-<label>
    const firstOption = page.locator('[data-testid^="chat-question-option-0-"]').first();
    await firstOption.waitFor({ timeout: 5_000 });
    await firstOption.click();

    // Submit must now be enabled
    await expect(page.locator('[data-testid="chat-question-submit"]')).toBeEnabled({ timeout: 3_000 });

    // Submit the answer
    await page.locator('[data-testid="chat-question-submit"]').click();
    await waitForIdle(page, 60_000);
  });
});
