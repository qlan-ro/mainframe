import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

test.describe('§20 Todos kanban', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    // A chat establishes the active project (todos are project-scoped via the active chat).
    await createTestChat(fixture.page, project.projectId, 'default');
    // Todos kanban is a plugin fullview, opened from its left-rail icon.
    await fixture.page.locator('[data-testid="left-rail-fullview-todos"]').click();
    await fixture.page.locator('[data-testid="todos-panel"]').waitFor({ timeout: 10_000 });
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('todos panel shows three columns', async () => {
    await expect(fixture.page.locator('[data-testid="todo-column-open"]')).toBeVisible();
    await expect(fixture.page.locator('[data-testid="todo-column-in_progress"]')).toBeVisible();
    await expect(fixture.page.locator('[data-testid="todo-column-done"]')).toBeVisible();
  });

  test('creates a new todo via the full modal', async () => {
    await fixture.page.locator('[data-testid="todos-new"]').click();
    await fixture.page.locator('[data-testid="todos-modal-title-input"]').fill('Test todo');
    await fixture.page.locator('[data-testid="todos-modal-save"]').click();
    await expect(
      fixture.page.locator('[data-testid="todo-column-open"] [data-testid="todo-card"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('clicking a card opens the TodoModal', async () => {
    await fixture.page.locator('[data-testid="todo-card"]').first().click();
    await expect(fixture.page.locator('[data-testid="todos-modal-dialog"]')).toBeVisible();
    await fixture.page.locator('[data-testid="todos-modal-close"]').click();
  });
});
