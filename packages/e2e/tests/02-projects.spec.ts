import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';

test.describe('§2 Project management', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
  });
  test.afterAll(async () => {
    await closeApp(fixture);
  });

  test('registers a project and shows it in the selector', async () => {
    const project = await createTestProject(fixture.page);
    try {
      await expect(fixture.page.locator('[data-testid="project-selector"]')).toBeVisible();
    } finally {
      await cleanupProject(project);
    }
  });

  test('switches between two projects', async () => {
    const p1 = await createTestProject(fixture.page);
    const p2 = await createTestProject(fixture.page);
    try {
      await fixture.page.locator('[data-testid="project-selector"]').click();
      await fixture.page.getByText(p2.projectPath.split('/').pop()!).click();
      await expect(fixture.page.locator('[data-testid="project-selector"]')).toContainText(
        p2.projectPath.split('/').pop()!,
      );
    } finally {
      await cleanupProject(p1);
      await cleanupProject(p2);
    }
  });
});
