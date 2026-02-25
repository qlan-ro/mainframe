import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';

test.describe('§20 Todos kanban', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await fixture.page.locator('[data-testid="todos-panel-icon"]').click();
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('todos panel shows three columns', async () => {
    const panel = fixture.page.locator('[data-testid="todos-panel"]');
    await expect(panel.locator('[data-testid="todo-column-open"]')).toBeVisible();
    await expect(panel.locator('[data-testid="todo-column-in_progress"]')).toBeVisible();
    await expect(panel.locator('[data-testid="todo-column-done"]')).toBeVisible();
  });

  test('creates a new todo', async () => {
    await fixture.page.getByRole('button', { name: /new/i }).click();
    await fixture.page.getByRole('textbox', { name: /title/i }).fill('Test todo');
    await fixture.page.getByRole('button', { name: /save/i }).click();
    await expect(fixture.page.locator('[data-testid="todo-column-open"] [data-testid="todo-card"]')).toBeVisible();
  });

  test('moves todo to In Progress', async () => {
    const card = fixture.page.locator('[data-testid="todo-column-open"] [data-testid="todo-card"]').first();
    const target = fixture.page.locator('[data-testid="todo-column-in_progress"]');
    await card.dragTo(target);
    await expect(
      fixture.page.locator('[data-testid="todo-column-in_progress"] [data-testid="todo-card"]'),
    ).toBeVisible();
  });

  test('clicking a card opens the TodoModal', async () => {
    await fixture.page.locator('[data-testid="todo-card"]').first().click();
    await expect(fixture.page.getByRole('dialog')).toBeVisible();
    await fixture.page.keyboard.press('Escape');
  });

  test('Start Session creates a linked chat', async () => {
    await fixture.page.locator('[data-testid="todo-card"]').first().click();
    await fixture.page.getByRole('button', { name: /start session/i }).click();
    await expect(fixture.page.locator('[data-testid="chat-list-item"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('deletes a todo', async () => {
    // Re-open todos panel (test 5 closed it when starting a session)
    await fixture.page.locator('[data-testid="todos-panel-icon"]').click();
    await expect(fixture.page.locator('[data-testid="todos-panel"]')).toBeVisible();
    const before = await fixture.page.locator('[data-testid="todo-card"]').count();
    const card = fixture.page.locator('[data-testid="todo-card"]').first();
    await card.hover();
    await card.getByRole('button', { name: /delete/i }).click();
    await expect(fixture.page.locator('[data-testid="todo-card"]')).toHaveCount(before - 1);
  });
});
