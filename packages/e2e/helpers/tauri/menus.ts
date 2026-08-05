import { expect, type Page } from '@playwright/test';

/**
 * Leave no Radix menu behind. Two hazards make this a hard requirement between
 * steps that both open a menu — both measured in a live Chromium (2026-08-06),
 * both invisible in jsdom:
 *
 *  1. A modal menu owns `<html>`'s pointer events while it is open, so a leftover
 *     menu makes the NEXT trigger click unhittable ("waiting for element to be
 *     visible, enabled and stable" on an element that is plainly there).
 *  2. Radix keeps a CLOSING menu's content mounted through its exit animation. A
 *     trigger click inside that window is SWALLOWED — the menu never reopens
 *     (`aria-expanded` stays false; the click after it works) — and a testid
 *     inside the dying menu still resolves, so the next menu's identical item
 *     trips strict mode with "resolved to 2 elements".
 *
 * `[role=menu]` covers dropdown, context and sub menus in both render trees, so
 * one Escape per nesting level plus the count assertion is the whole contract.
 * Never substitute a `waitForTimeout` here: the wait is on state that Radix
 * actually reports.
 */
export async function closeMenus(page: Page, maxLayers = 4): Promise<void> {
  const menus = page.locator('[role="menu"]');
  for (let layer = 0; layer < maxLayers && (await menus.count()) > 0; layer++) {
    await page.keyboard.press('Escape');
  }
  await expect(menus).toHaveCount(0, { timeout: 5_000 });
}
