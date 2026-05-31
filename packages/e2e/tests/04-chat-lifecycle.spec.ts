import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

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

  test('creates a new chat', async () => {
    await createTestChat(fixture.page, project.projectId);
    await expect(fixture.page.locator('[data-testid="chat-list-item"]').first()).toBeVisible();
  });

  test('switches between chats by clicking the list', async () => {
    await createTestChat(fixture.page, project.projectId);
    await createTestChat(fixture.page, project.projectId);
    const items = fixture.page.locator('[data-testid="chat-list-item"]');
    await items.nth(0).click();
    await items.nth(1).click();
  });

  test('archives a chat', async () => {
    const before = await fixture.page.locator('[data-testid="chat-list-item"]').count();
    const first = fixture.page.locator('[data-testid="chat-list-item"]').first();
    await first.hover();
    // Row actions only render/size on hover; dispatch the click via the DOM to avoid fighting the
    // reveal timing (force-click still needs a hit box, which these don't reliably have).
    await first
      .locator('[data-testid^="chats-session-archive-"]')
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    await expect(fixture.page.locator('[data-testid="chat-list-item"]')).toHaveCount(before - 1);
  });
});
