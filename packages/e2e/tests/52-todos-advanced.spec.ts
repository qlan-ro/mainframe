import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

// New coverage from scenarios/todos.md — filter, edit, delete, and body field (19-todos covers
// columns/create/modal-open). No AI.
test.describe('§52 Todos — filter, edit, delete', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'default');
    await fixture.page.locator('[data-testid="left-rail-fullview-todos"]').click();
    await fixture.page.locator('[data-testid="todos-panel"]').waitFor({ timeout: 10_000 });
    fixture.page.on('dialog', (d) => {
      void d.accept().catch(() => {});
    });
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  async function createTodo(title: string): Promise<void> {
    await fixture.page.locator('[data-testid="todos-new"]').click();
    await fixture.page.locator('[data-testid="todos-modal-title-input"]').fill(title);
    await fixture.page.locator('[data-testid="todos-modal-save"]').click();
    await fixture.page.locator('[data-testid="todos-modal-dialog"]').waitFor({ state: 'hidden', timeout: 10_000 });
  }

  test('creates a todo with a body and shows it on the board', async () => {
    await fixture.page.locator('[data-testid="todos-new"]').click();
    await fixture.page.locator('[data-testid="todos-modal-title-input"]').fill('Body todo');
    await fixture.page.locator('[data-testid="todos-modal-body-input"]').fill('Some task details here.');
    await fixture.page.locator('[data-testid="todos-modal-save"]').click();
    await expect(fixture.page.getByText('Body todo').first()).toBeVisible({ timeout: 10_000 });
  });

  test('filters the board by title', async () => {
    await createTodo('UniqueFilterTarget');
    const search = fixture.page.locator('[data-testid="todos-filter-search"]');
    await search.fill('UniqueFilterTarget');
    await expect(fixture.page.getByText('UniqueFilterTarget').first()).toBeVisible({ timeout: 5_000 });
    await expect(fixture.page.getByText('Body todo')).toHaveCount(0);
    await fixture.page.locator('[data-testid="todos-filter-search-clear"]').click();
    await expect(fixture.page.getByText('Body todo').first()).toBeVisible({ timeout: 5_000 });
  });

  test('edits a todo via its card action', async () => {
    const card = fixture.page.locator('[data-testid="todo-card"]').first();
    await card.hover();
    await fixture.page
      .locator('[data-testid^="todos-card-edit-"]')
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    await expect(fixture.page.locator('[data-testid="todos-modal-dialog"]')).toBeVisible({ timeout: 5_000 });
    await fixture.page.locator('[data-testid="todos-modal-title-input"]').fill('Edited title');
    await fixture.page.locator('[data-testid="todos-modal-save"]').click();
    await expect(fixture.page.getByText('Edited title').first()).toBeVisible({ timeout: 10_000 });
  });

  test('deletes a todo via its card action', async () => {
    const cards = fixture.page.locator('[data-testid="todo-card"]');
    const before = await cards.count();
    await cards.first().hover();
    await fixture.page
      .locator('[data-testid^="todos-card-delete-"]')
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    await expect(cards).toHaveCount(before - 1, { timeout: 10_000 });
  });
});
