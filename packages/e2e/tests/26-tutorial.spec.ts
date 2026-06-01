import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import type { ProjectFixture } from '../fixtures/project.js';

test.describe('§26 Tutorial overlay', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;

  test.beforeAll(async () => {
    // This spec exercises the tutorial itself — opt out of launchApp's default suppression.
    fixture = await launchApp({ skipTutorial: false });
    // Fresh Chromium profile already means empty localStorage, but clear + reload defensively so
    // the tutorial starts at step 1 regardless of any default persisted state.
    await fixture.page.evaluate(() => localStorage.clear());
    await fixture.page.reload();
    await fixture.page
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });
  });
  test.afterAll(async () => {
    await closeApp(fixture);
  });

  test('step 1 shows on fresh launch with correct content', async () => {
    const { page } = fixture;
    const overlay = page.locator('[data-testid="tutorial-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Add a project');
    // Action-required step → no "Next" button
    await expect(overlay.getByRole('button', { name: /Next/ })).toHaveCount(0);
    await expect(page.locator('[data-testid="tutorial-skip-btn"]')).toBeVisible();
  });

  test('tutorial hides when the directory picker opens', async () => {
    const { page } = fixture;
    // The step-1 target (chats-add-project) is interactive through the spotlight.
    await page.locator('[data-testid="chats-add-project"]').click();
    await page.locator('[data-testid="dir-picker-modal"]').waitFor({ timeout: 5_000 });
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="dir-picker-modal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible({ timeout: 5_000 });
  });

  test('step 1 → 2: auto-advances when a project is added', async () => {
    const { page } = fixture;
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Add a project');
    const project = await createTestProject(page);
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Start a session', { timeout: 5_000 });
    await expect(page.locator('[data-testid="tutorial-overlay"]').getByRole('button', { name: /Next/ })).toHaveCount(0);
    (fixture as unknown as Record<string, unknown>)._tutorialProject = project;
  });

  test('step 2 → 3: auto-advances when a session is created', async () => {
    const { page } = fixture;
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Start a session');
    // The step-2 target is the new-session button.
    await page.locator('[data-tutorial="step-2"]').click();
    await page.getByRole('textbox').first().waitFor({ timeout: 10_000 });
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Chat with your agent', { timeout: 5_000 });
    // Step 3 is not action-required → it has a Next button
    await expect(page.locator('[data-testid="tutorial-next-btn"]')).toBeVisible();
  });

  test('step 3 → 4: advances via the Next button', async () => {
    const { page } = fixture;
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Chat with your agent');
    await page.locator('[data-testid="tutorial-next-btn"]').click();
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Select a provider', { timeout: 5_000 });
  });

  test('skip dismisses the overlay permanently', async () => {
    const { page } = fixture;
    const project = (fixture as unknown as Record<string, unknown>)._tutorialProject as ProjectFixture | undefined;
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible();
    await page.locator('[data-testid="tutorial-skip-btn"]').click();
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toHaveCount(0);

    // Stays dismissed across a reload (persisted in localStorage)
    await page.reload();
    await page
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toHaveCount(0);

    if (project) await cleanupProject(project);
  });
});
