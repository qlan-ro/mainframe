import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

// New coverage from scenarios/sessions.md (SP1, SP6, SP8, SP9). No AI — sessions are created
// without sending messages. Tests run serially and share app state.
test.describe('§45 Sessions panel', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'default');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('SP1: new-session button adds a session (single project)', async () => {
    const rows = fixture.page.locator('[data-testid="chat-list-item"]');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await fixture.page.locator('[data-testid="chats-new-session"]').click();
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
  });

  test('SP6: rename a session', async () => {
    const row = fixture.page.locator('[data-testid="chat-list-item"]').first();
    await row.hover();
    // Row actions render/size only on hover — dispatch via the DOM to avoid reveal-timing flake.
    await fixture.page
      .locator('[data-testid^="chats-session-rename-"]')
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    const input = fixture.page.locator('[data-testid^="chats-session-rename-input-"]').first();
    await input.fill('Renamed session');
    await input.press('Enter');
    await expect(fixture.page.getByText('Renamed session').first()).toBeVisible({ timeout: 5_000 });
  });

  test('SP8: archive a session', async () => {
    const rows = fixture.page.locator('[data-testid="chat-list-item"]');
    const before = await rows.count();
    await rows.first().hover();
    await fixture.page
      .locator('[data-testid^="chats-session-archive-"]')
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    await expect(rows).toHaveCount(before - 1, { timeout: 10_000 });
  });

  test('SP9: view and restore an archived session', async () => {
    // Archiving calls removeChat (drops the chat from the client store), so a freshly-archived chat
    // only re-enters the store via a refetch. Reload to resync archived chats from the daemon.
    await fixture.page.reload();
    await fixture.page
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });
    await fixture.page.locator('[data-testid="archived-sessions-btn"]').click();
    await expect(fixture.page.locator('[data-testid="archived-session-item"]').first()).toBeVisible({
      timeout: 5_000,
    });
    await fixture.page.locator('[data-testid="restore-session-btn"]').first().click();
    await expect(fixture.page.locator('[data-testid="chat-list-item"]').first()).toBeVisible({ timeout: 10_000 });
  });
});
