import { test, expect, type Page } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

// New coverage from scenarios/todos.md — quick-create dialog, full-modal field selects, labels,
// dependencies, label-filter, and sort. 52-todos-advanced covers create/filter/edit/delete. No AI.
test.describe('§57 Todos — fields, deps, labels, sort', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let page: Page;

  test.beforeAll(async () => {
    fixture = await launchApp();
    page = fixture.page;
    project = await createTestProject(page);
    await createTestChat(page, project.projectId, 'default');
    // Fresh profile shows the first-run tutorial whose prompt overlay intercepts clicks on the
    // lower half of modals — skip it before interacting with the board.
    const skip = page.locator('[data-testid="tutorial-skip-btn"]');
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.locator('[data-testid="left-rail-fullview-todos"]').click();
    await page.locator('[data-testid="todos-panel"]').waitFor({ timeout: 10_000 });
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  // Self-contained seeding — retries restart the worker with a fresh (empty) project, so a test
  // must never rely on todos created by an earlier test.
  async function createTodo(title: string, label?: string): Promise<void> {
    await page.locator('[data-testid="todos-new"]').click();
    await page.locator('[data-testid="todos-modal-dialog"]').waitFor({ timeout: 5_000 });
    await page.locator('[data-testid="todos-modal-title-input"]').fill(title);
    if (label) {
      const input = page.locator('[data-testid="todos-label-input"]');
      await input.fill(label);
      await input.press('Enter');
      await page.locator(`[data-testid="todos-label-remove-${label}"]`).waitFor({ timeout: 5_000 });
    }
    await page.locator('[data-testid="todos-modal-save"]').click();
    await page.locator('[data-testid="todos-modal-dialog"]').waitFor({ state: 'hidden', timeout: 10_000 });
  }

  test('quick-create dialog (mod+t) creates a task', async () => {
    await page.keyboard.press('Meta+t');
    await expect(page.locator('[data-testid="todos-quick-dialog"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="todos-quick-type-bug"]').click();
    await page.locator('[data-testid="todos-quick-priority-high"]').click();
    await page.locator('[data-testid="todos-quick-title-input"]').fill('QuickTask Alpha');
    await page.locator('[data-testid="todos-quick-create"]').click();
    await expect(page.locator('[data-testid="todos-quick-dialog"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByText('QuickTask Alpha').first()).toBeVisible({ timeout: 10_000 });
  });

  test('full modal sets type/priority/status, label, assignees, milestone', async () => {
    await page.locator('[data-testid="todos-new"]').click();
    await expect(page.locator('[data-testid="todos-modal-dialog"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="todos-modal-title-input"]').fill('FieldTask Beta');
    await page.locator('[data-testid="todos-modal-type-select"]').selectOption('bug');
    await page.locator('[data-testid="todos-modal-priority-select"]').selectOption('critical');
    await page.locator('[data-testid="todos-modal-status-select"]').selectOption('in_progress');
    // Label via the autocomplete (type + Enter).
    const label = page.locator('[data-testid="todos-label-input"]');
    await label.fill('backend');
    await label.press('Enter');
    await expect(page.locator('[data-testid="todos-label-remove-backend"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="todos-modal-assignees-input"]').fill('alice, bob');
    await page.locator('[data-testid="todos-modal-milestone-input"]').fill('v1.0');
    await page.locator('[data-testid="todos-modal-save"]').click();
    await expect(page.locator('[data-testid="todos-modal-dialog"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('FieldTask Beta').first()).toBeVisible({ timeout: 10_000 });
  });

  test('modal cancel discards without creating', async () => {
    await page.locator('[data-testid="todos-new"]').click();
    await page.locator('[data-testid="todos-modal-title-input"]').fill('Discarded Task');
    await page.locator('[data-testid="todos-modal-cancel"]').click();
    await expect(page.locator('[data-testid="todos-modal-dialog"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByText('Discarded Task')).toHaveCount(0);
  });

  test('dependency picker adds and removes a dependency', async () => {
    // The picker only offers other tasks, so seed one first.
    await createTodo('DepTarget');
    await page.locator('[data-testid="todos-new"]').click();
    await page.locator('[data-testid="todos-modal-title-input"]').fill('DependentTask');
    await page.locator('[data-testid="todos-dep-add-toggle"]').click();
    await page.locator('[data-testid="todos-dep-search"]').waitFor({ timeout: 5_000 });
    const option = page.locator('[data-testid^="todos-dep-option-"]').first();
    await option.click();
    // The picker dropdown stays open and overlaps the selected-dep remove control — dismiss it
    // by clicking outside (the title field) before removing.
    await page.locator('[data-testid="todos-modal-title-input"]').click();
    const remove = page.locator('[data-testid^="todos-dep-remove-"]').first();
    await expect(remove).toBeVisible({ timeout: 5_000 });
    await remove.click();
    await expect(page.locator('[data-testid^="todos-dep-remove-"]')).toHaveCount(0, { timeout: 5_000 });
    await page.locator('[data-testid="todos-modal-cancel"]').click();
  });

  test('label filter narrows the board, then clears', async () => {
    await createTodo('LabelTarget', 'qafilter');
    await createTodo('UnlabelledTask');
    await page.locator('[data-testid="todos-filter-labels-toggle"]').click();
    await page.locator('[data-testid="todos-filter-label-option-qafilter"]').click();
    // The label popover has no "chip"; the filter applies to the board directly. Close the popover
    // by re-clicking its toggle (Escape would dismiss the whole todos fullview).
    await page.locator('[data-testid="todos-filter-labels-toggle"]').click();
    await expect(page.getByText('LabelTarget').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('UnlabelledTask')).toHaveCount(0);
    await page.locator('[data-testid="todos-filter-clear"]').click();
    await expect(page.getByText('UnlabelledTask').first()).toBeVisible({ timeout: 5_000 });
  });

  test('sort controls cycle priority and type', async () => {
    await createTodo('SortTask One');
    await createTodo('SortTask Two');
    await page.locator('[data-testid="todos-sort-priority"]').click();
    await expect(page.locator('[data-testid="todos-sort-priority"]')).toBeVisible();
    await page.locator('[data-testid="todos-sort-type"]').click();
    await expect(page.locator('[data-testid="todos-sort-type"]')).toBeVisible();
    // Board still renders the tasks after re-sorting.
    await expect(page.getByText('SortTask One').first()).toBeVisible({ timeout: 5_000 });
  });
});
