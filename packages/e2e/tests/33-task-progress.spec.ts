import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { sendMessage, waitForAIIdle } from '../helpers/wait.js';

// TaskCreate/TaskUpdate are deferred tools only available in interactive Claude CLI.
// When spawned with --output-format stream-json (Mainframe mode), the CLI exposes
// fewer deferred tools and TaskCreate is NOT among them — the model falls back to
// TodoWrite instead. Until this is resolved, these tests are skipped.
const OPUS_MODEL = 'claude-opus-4-6';

test.describe.skip('§33 Task progress card', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await fixture.page.evaluate(
      ({ pid, model }) => {
        const client = (window as any).__daemonClient;
        client.createChat(pid, 'claude', model, 'yolo');
      },
      { pid: project.projectId, model: OPUS_MODEL },
    );
    await fixture.page.getByRole('textbox').waitFor({ timeout: 10_000 });
  });

  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('TaskCreate renders task progress card with items', async () => {
    const { page } = fixture;

    await sendMessage(page, 'Create 2 dummy tasks, I want to test your Tasks feature.');

    const progressCard = page.locator('[data-testid="task-progress-card"]');
    await expect(progressCard).toBeVisible({ timeout: 90_000 });

    const items = progressCard.locator('[data-testid^="task-progress-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10_000 });
    expect(await items.count()).toBeGreaterThanOrEqual(2);

    await waitForAIIdle(page, 90_000);
  });

  test('TaskUpdate transitions tasks to completed', async () => {
    const { page } = fixture;

    await sendMessage(page, 'Mark both tasks as completed using TaskUpdate.');

    await waitForAIIdle(page, 90_000);

    const progressCard = page.locator('[data-testid="task-progress-card"]');
    await expect(progressCard).toBeVisible({ timeout: 10_000 });
    const completedItems = progressCard.locator('[data-testid="task-progress-item-completed"]');
    await expect(completedItems.first()).toBeVisible({ timeout: 10_000 });
    expect(await completedItems.count()).toBeGreaterThanOrEqual(2);
  });
});
