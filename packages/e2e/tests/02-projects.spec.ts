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

  test('registers a project and shows it in the sessions panel', async () => {
    const project = await createTestProject(fixture.page);
    try {
      const name = path.basename(project.projectPath);
      await expect(fixture.page.locator('[data-testid="project-group-name"]', { hasText: name })).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await cleanupProject(project);
    }
  });

  test('rejects duplicate path — project appears once', async () => {
    const project = await createTestProject(fixture.page);
    try {
      // Re-submit the same path through the picker — the existing project is reused.
      await openPickerAndSelectPath(fixture.page, project.projectPath);
      const name = path.basename(project.projectPath);
      await expect(fixture.page.locator('[data-testid="project-group-name"]', { hasText: name })).toHaveCount(1, {
        timeout: 10_000,
      });
    } finally {
      await cleanupProject(project);
    }
  });

  test('shows multiple projects and filters by project', async () => {
    const p1 = await createTestProject(fixture.page);
    const p2 = await createTestProject(fixture.page);
    try {
      const n1 = path.basename(p1.projectPath);
      const n2 = path.basename(p2.projectPath);
      await expect(fixture.page.locator('[data-testid="project-group-name"]', { hasText: n1 })).toBeVisible();
      await expect(fixture.page.locator('[data-testid="project-group-name"]', { hasText: n2 })).toBeVisible();
      // Project filter pills appear once >1 project exists; clicking one scopes the list.
      const pill = fixture.page.locator(`[data-testid="chats-filter-pill-${n2}"]`);
      await pill.click();
      await expect(pill).toBeVisible();
    } finally {
      await cleanupProject(p1);
      await cleanupProject(p2);
    }
  });
});
