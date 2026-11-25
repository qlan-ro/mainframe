import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

async function readEarlierTools(page: Page) {
  const viewport = page.getByTestId('chat-thread-viewport');
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeLessThan(1);
}

test.describe('§tool-cards — Plan revision (plan-revision)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'plan-revision' });
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

  test('a rejected plan (keep-planning → feedback) echoes the feedback as a user message and renders the first PlanCard as an error', async () => {
    const { page } = app;
    await sendMessage(page, 'Add `export function multiply(a: number, b: number) { return a * b; }` to utils.ts');
    await page.getByTestId('chat-plan-gate').waitFor({ timeout: 45_000 });

    await page.getByTestId('chat-plan-keep-planning').click();
    await expect(page.getByTestId('chat-plan-feedback-input')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('chat-plan-feedback-input').fill('Please also add a divide function');
    await page.getByTestId('chat-plan-send-feedback').click();

    await expect(
      page.getByTestId('chat-user-message').filter({ hasText: 'Please also add a divide function' }),
    ).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId('chat-plan-gate').waitFor({ timeout: 45_000 });

    await readEarlierTools(page);
    const marker = page.getByTestId('chat-marker-exitplanmode').first();
    await expect(marker).toContainText('Updated plan', { timeout: 10_000 });
    await expect(marker).toContainText('failed');
    await expect(marker).toHaveAttribute('data-state', 'failed');
    await expect(marker).toBeEnabled();
    await marker.click();
    const body = page.getByTestId('chat-marker-exitplanmode-body').first();
    await expect(body).toContainText("The user doesn't want to proceed with this tool use");
    await expect(body).toContainText('Please also add a divide function');
    // The plan itself stays, over what was said about it.
    await expect(body.getByRole('heading', { name: 'Add multiply() function to utils.ts' })).toBeVisible();

    await page.getByTestId('chat-plan-reject').click();
    await waitForIdle(page, 5_000).catch(() => {});
  });
});

test.describe('§tool-cards — Skill (chat-status)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'chat-status' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a skill is one pill: the call, and the text the CLI loaded for it', async () => {
    const { page } = app;

    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');
    await waitForIdle(page, 60_000);

    await sendMessage(
      page,
      'Now explain TypeScript mapped types, conditional types, and template literal types. Be thorough.',
    );

    await waitForIdle(page, 60_000);
    await readEarlierTools(page);
    const pill = page.getByTestId('chat-marker-skill').first();
    await pill.waitFor({ timeout: 60_000 });
    await expect(pill).toContainText('Used skill /writing-clearly-and-concisely');
    await expect(page.getByTestId('chat-skill-loaded-pill')).toHaveCount(0);

    const body = page.getByTestId('chat-marker-skill-body');
    await expect(body).toHaveCount(0);
    await pill.click();
    await expect(body).toContainText('Writing Clearly and Concisely');
    await pill.click();
    await expect(body).toHaveCount(0);
  });
});
