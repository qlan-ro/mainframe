/**
 * §focus-line — fields that draw no chrome of their own still show the focus line
 * (C3 and the accessibility floor in design/redesign/DECISIONS.md).
 *
 * packages/ui/src/__tests__/focus-indicator-audit.test.ts polices the class names; this
 * spec reads what the browser painted, because a utility can cancel a base-layer rule
 * that still looks right in the source.
 */
import { test, expect, type Locator } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriChat, createTauriProject, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

/** The 2 px solid line on the focused element, or on the frame it sits in. */
async function paintsFocusLine(field: Locator): Promise<boolean> {
  return field.evaluate((el) => {
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
      const { outlineStyle, outlineWidth } = getComputedStyle(node);
      if (outlineStyle === 'solid' && outlineWidth === '2px') return true;
    }
    return false;
  });
}

test.describe('§focus-line', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await app.page.getByTestId('shell-rail-automations').click();
    await app.page.getByTestId('automations-sidebar-new').click();
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  for (const id of ['automations-editor-name', 'automations-editor-description']) {
    test(`${id} shows the line while focused, and only then`, async () => {
      const field = app.page.getByTestId(id);
      await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      expect(await paintsFocusLine(field)).toBe(false);
      await field.focus();
      expect(await paintsFocusLine(field)).toBe(true);
    });
  }

  test('a search field with no frame of its own shows the line on its row', async () => {
    const { page } = app;
    await page.getByTestId('automations-recipe-root-add').click();
    const search = page.getByTestId('automations-recipe-root-add-search');
    await search.focus();
    expect(await paintsFocusLine(search)).toBe(true);
    await page.keyboard.press('Escape');
  });

  test('a composer toolbar chip reached by keyboard shows the line', async () => {
    const { page } = app;
    await createTauriChat(page, project.projectId);
    await page.getByTestId('chat-composer-input').focus();
    const chip = page.getByTestId('composer-permission-mode-select');
    for (let i = 0; i < 12 && !(await chip.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(chip).toBeFocused();
    const { outlineStyle, outlineWidth } = await chip.evaluate((el) => getComputedStyle(el));
    expect([outlineStyle, outlineWidth]).toEqual(['solid', '2px']);
  });
});
