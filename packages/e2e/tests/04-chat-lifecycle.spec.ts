import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';

test.describe('§4 Chat lifecycle', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('creates a new chat with Cmd+N', async () => {
    await fixture.page.keyboard.press('Meta+n');
    await expect(fixture.page.locator('[data-testid="chat-list-item"]').first()).toBeVisible();
  });

  test('switches between chats by clicking the list', async () => {
    await fixture.page.keyboard.press('Meta+n');
    await fixture.page.keyboard.press('Meta+n');
    const items = fixture.page.locator('[data-testid="chat-list-item"]');
    await items.nth(0).click();
    await items.nth(1).click();
  });

  test('archives a chat', async () => {
    const before = await fixture.page.locator('[data-testid="chat-list-item"]').count();
    const first = fixture.page.locator('[data-testid="chat-list-item"]').first();
    await first.hover();
    await first.getByRole('button', { name: /archive/i }).click();
    await expect(fixture.page.locator('[data-testid="chat-list-item"]')).toHaveCount(before - 1);
  });
});
