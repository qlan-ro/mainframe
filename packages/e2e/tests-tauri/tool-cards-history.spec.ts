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
    const planCard = page.getByTestId('chat-plan-card').first();
    await expect(planCard).toBeVisible({ timeout: 10_000 });
    await expect(planCard.getByTestId('chat-plan-label')).toHaveText('Updated plan');
    await expect(planCard.getByTestId('chat-plan-trigger')).toBeEnabled();
    await expect(planCard.getByTestId('chat-plan-trigger').locator('..')).toHaveClass(/border-destructive/);
    await expect(planCard.getByTestId('chat-plan-body')).toContainText(
      "The user doesn't want to proceed with this tool use",
    );
    await expect(planCard.getByTestId('chat-plan-body')).toContainText('Please also add a divide function');

    await page.getByTestId('chat-plan-reject').click();
    await waitForIdle(page, 5_000).catch(() => {});
  });
});

test.describe('§tool-cards — Skill + SkillLoaded (chat-status)', () => {
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

  test('Skill tool call renders the slash-command row; onSkillLoaded renders an expandable system pill', async () => {
    const { page } = app;

    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');
    await waitForIdle(page, 60_000);

    await sendMessage(
      page,
      'Now explain TypeScript mapped types, conditional types, and template literal types. Be thorough.',
    );

    await waitForIdle(page, 60_000);
    await readEarlierTools(page);
    const slashRow = page.getByTestId('chat-slash-command-row').first();
    await slashRow.waitFor({ timeout: 60_000 });
    await expect(slashRow).toContainText('/writing-clearly-and-concisely');

    const pill = page.getByTestId('chat-skill-loaded-pill').first();
    await pill.waitFor({ timeout: 15_000 });
    await expect(pill).toBeEnabled();

    await expect(page.getByTestId('marker-body')).toHaveCount(0);
    await pill.click();
    const body = page.getByTestId('marker-body');
    await expect(body).toBeVisible({ timeout: 5_000 });
    await expect(body).toContainText('Writing Clearly and Concisely');

    await pill.click();
    await expect(page.getByTestId('marker-body')).toHaveCount(0);
  });
});
