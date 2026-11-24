/**
 * §overlay-scrollbars — the app-wide overlay scrollbar (S3 in design/redesign/DECISIONS.md).
 *
 * The geometry and timing are unit-covered (packages/ui/src/lib/overlay-scrollbars/__tests__);
 * this spec covers what jsdom has no layout for: native scrollbars take no width, the thumb
 * appears where the pointer is, and dragging it scrolls without closing the dialog it belongs to.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { DAEMON_BASE } from '../fixtures/daemon.js';
import { createTauriChat, createTauriProject, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { waitConnected } from '../helpers/tauri/wait.js';

const thumb = (page: Page): Locator => page.locator('.mf-scrollbar[data-axis="y"][data-visible]:not([hidden])');

/** The nearest vertical scroll container around `locator`. */
async function scroller(locator: Locator) {
  return locator.evaluateHandle((el) => {
    let node: Element | null = el;
    while (node && !/auto|scroll/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
    return node as HTMLElement;
  });
}

test.describe('§overlay-scrollbars', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await app.page.setViewportSize({ width: 1200, height: 500 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a scrolling pane keeps its full width, shows a thumb under the pointer and scrolls by dragging it', async () => {
    const { page } = app;
    await page.getByTestId('shell-rail-settings').click();
    const pane = page.getByTestId('settings-pane-general');
    await pane.waitFor({ timeout: 10_000 });
    const area = await scroller(pane);
    expect(await area.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await area.evaluate((el) => el.offsetWidth - el.clientWidth)).toBe(0);

    await expect(thumb(page)).toHaveCount(0);
    await pane.hover();
    await expect(thumb(page)).toHaveCount(1);

    const box = (await thumb(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 60);
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
    await page.mouse.up();

    await page.mouse.move(5, 5);
    await expect(thumb(page)).toHaveCount(0, { timeout: 5_000 });
  });

  test('dragging the thumb of a dialog keeps the dialog open', async () => {
    const { page } = app;
    await page.getByTestId('shell-rail-tasks').click();
    await page.getByTestId('tasks-sidebar-new').click();
    const title = page.getByTestId('tasks-edit-title');
    await title.hover();
    await expect(thumb(page)).toHaveCount(1);

    const area = await scroller(title);
    const box = (await thumb(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.mouse.up();
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
    await expect(title).toBeAttached();
  });

  test('the sidebar shows a thumb on its resize edge; the thumb scrolls and the edge still resizes', async () => {
    const { page } = app;
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${DAEMON_BASE}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.projectId, adapterId: 'mock-cli', permissionMode: 'default' }),
      });
      expect(res.ok).toBe(true);
    }
    await page.reload();
    await waitConnected(page);
    await page.getByTestId('shell-rail-chats').click();
    const row = page.getByTestId('sessions-row').nth(3);
    await row.hover();
    await expect(thumb(page)).toHaveCount(1);

    const area = await scroller(row);
    const sidebar = page.locator('[data-slot="sidebar"]');
    const width = async (): Promise<number> => (await sidebar.boundingBox())!.width;
    const startWidth = await width();
    const box = (await thumb(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.mouse.up();
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
    expect(await width()).toBe(startWidth);

    // With the thumb on show, the panel's outermost pixels still resize it, beside the thumb and past it.
    for (const place of ['beside', 'past'] as const) {
      await row.hover();
      await expect(thumb(page)).toHaveCount(1);
      const shown = (await thumb(page).boundingBox())!;
      const rail = (await page.locator('[data-slot="sidebar-rail"]').boundingBox())!;
      const x = rail.x + rail.width - 1;
      const y = place === 'beside' ? shown.y + shown.height / 2 : shown.y + shown.height + 20;
      const before = await width();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 30, y, { steps: 4 });
      await page.mouse.up();
      expect((await width()) - before).toBe(30);
    }
  });

  test('dragging the thumb of the floating session panel keeps the panel open', async () => {
    const { page } = app;
    await createTauriChat(page, project.projectId);
    await page.setViewportSize({ width: 1150, height: 330 });
    await page.getByTestId('session-panel-toggle').click();
    const panel = page.getByTestId('session-panel-overlay');
    const card = panel.getByTestId('session-panel-card-session');
    await card.hover();
    await expect(thumb(page)).toHaveCount(1);

    const area = await scroller(card);
    const box = (await thumb(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 60);
    await page.mouse.up();
    await expect(panel).toBeVisible();
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(10);
  });
});
