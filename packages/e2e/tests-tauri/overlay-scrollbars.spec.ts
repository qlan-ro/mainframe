/**
 * §overlay-scrollbars — the app-wide overlay scrollbar (S3 in design/redesign/DECISIONS.md).
 *
 * The geometry and timing are unit-covered (packages/ui/src/lib/overlay-scrollbars/__tests__);
 * this spec covers what jsdom has no layout for: native scrollbars take no width, the thumb
 * appears where the pointer is, and dragging it scrolls without closing the dialog it belongs to.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

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
});
