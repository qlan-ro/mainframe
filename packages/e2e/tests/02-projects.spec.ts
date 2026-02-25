import { test, expect } from '@playwright/test';
import path from 'path';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject, openPickerAndSelectPath } from '../fixtures/project.js';

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

  test('rejects duplicate path — project appears once in the dropdown', async () => {
    const project = await createTestProject(fixture.page);
    try {
      // Re-submit the same path through the picker
      await openPickerAndSelectPath(fixture.page, project.projectPath);

      // The project should still be active (the existing project is activated)
      const projectName = path.basename(project.projectPath);
      await fixture.page
        .locator('[data-testid="project-selector"]')
        .getByText(projectName, { exact: true })
        .waitFor({ timeout: 5_000 });

      // Open the dropdown and verify no duplicate entry was added
      await fixture.page.locator('[data-testid="project-selector"]').click();
      await expect(
        fixture.page.locator('[data-testid="project-dropdown"]').getByText(projectName, { exact: true }),
      ).toHaveCount(1);
      // Close the dropdown by clicking the selector again (Escape has no handler in TitleBar)
      await fixture.page.locator('[data-testid="project-selector"]').click();
    } finally {
      await cleanupProject(project);
    }
  });

  test('switches between two projects', async () => {
    const p1 = await createTestProject(fixture.page);
    const p2 = await createTestProject(fixture.page);
    try {
      await fixture.page.locator('[data-testid="project-selector"]').click();
      await fixture.page
        .locator('[data-testid="project-dropdown"]')
        .getByText(p2.projectPath.split('/').pop()!, { exact: true })
        .click();
      await expect(fixture.page.locator('[data-testid="project-selector"]')).toContainText(
        p2.projectPath.split('/').pop()!,
      );
    } finally {
      await cleanupProject(p1);
      await cleanupProject(p2);
    }
  });
});
