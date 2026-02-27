import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import type { ProjectFixture } from '../fixtures/project.js';

test.describe('§26 Tutorial overlay', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;

  test.beforeAll(async () => {
    fixture = await launchApp();

    // Clear all persisted Zustand stores — Electron localStorage persists across
    // test runs. Tutorial auto-advances based on projects/chats store state, so
    // clearing only mf:tutorial isn't enough.
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

    // Verify step 1 content
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Add a project');

    // No "Next" button on action-required steps
    await expect(overlay.getByRole('button', { name: /Next/ })).toHaveCount(0);

    // Skip tutorial link is present
    await expect(page.getByText('Skip tutorial')).toBeVisible();
  });

  test('tutorial hides when directory picker modal opens', async () => {
    const { page } = fixture;

    // Open dropdown and click Add project to open the modal
    await page.locator('[data-testid="project-selector"]').click();
    await page.locator('[data-testid="project-dropdown"]').getByText('Add project').click();
    await page.locator('[data-testid="dir-picker-modal"]').waitFor({ timeout: 5_000 });

    // Tutorial overlay should be hidden while modal is open
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toHaveCount(0);

    // Close the modal
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="dir-picker-modal"]')).toHaveCount(0);

    // Tutorial reappears
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible({ timeout: 5_000 });
  });

  test('step 1 → 2: auto-advances when project is added', async () => {
    const { page } = fixture;

    // Verify we're on step 1
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Add a project');

    // Add a project (this triggers auto-advance)
    const project = await createTestProject(page);

    // Should auto-advance to step 2
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Start a session', {
      timeout: 5_000,
    });

    // Still no "Next" button on step 2
    await expect(page.locator('[data-testid="tutorial-overlay"]').getByRole('button', { name: /Next/ })).toHaveCount(0);

    // Store project for cleanup
    (fixture as Record<string, unknown>)._tutorialProject = project;
  });

  test('step 2 → 3: auto-advances when session is created', async () => {
    const { page } = fixture;
    const project = (fixture as Record<string, unknown>)._tutorialProject as ProjectFixture;

    // Verify we're on step 2
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Start a session');

    // Click the new session button (step-2 target)
    await page.locator('[data-tutorial="step-2"]').click();

    // Wait for composer to appear (session created)
    await page.getByRole('textbox').waitFor({ timeout: 10_000 });

    // Should auto-advance to step 3
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Chat with your agent', {
      timeout: 5_000,
    });

    // Step 3 has a "Next" button (not action-required)
    await expect(page.locator('[data-testid="tutorial-overlay"]').getByRole('button', { name: /Next/ })).toBeVisible();

    // Clean up
    await cleanupProject(project);
  });

  test('step 3 → 4: advances via Next button', async () => {
    const { page } = fixture;

    // Verify we're on step 3
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Chat with your agent');

    // Click Next
    await page.locator('[data-testid="tutorial-overlay"]').getByRole('button', { name: /Next/ }).click();

    // Should advance to step 4
    await expect(page.locator('[data-testid="tutorial-title"]')).toHaveText('Select a provider', {
      timeout: 5_000,
    });
  });

  test('skip tutorial dismisses the overlay permanently', async () => {
    const { page } = fixture;

    // Tutorial should be visible
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible();

    // Click skip
    await page.getByText('Skip tutorial').click();

    // Overlay should disappear
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toHaveCount(0);

    // Reload the page — tutorial should stay dismissed (persisted in localStorage)
    await page.reload();
    await page
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });

    await expect(page.locator('[data-testid="tutorial-overlay"]')).toHaveCount(0);
  });
});
