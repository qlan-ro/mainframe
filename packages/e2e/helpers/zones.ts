import { expect, type Page } from '@playwright/test';

/**
 * Reveal a right-side zone tab via its rail button (e.g. zone-rail-button-changes/files/context).
 * Rail buttons TOGGLE the zone tab and the default-active tab is not guaranteed, so only click
 * when the target content isn't already visible. Resolves once the content is shown.
 */
export async function openZone(page: Page, railButtonTestid: string, contentTestid: string): Promise<void> {
  const content = page.locator(`[data-testid="${contentTestid}"]`);
  if (!(await content.isVisible())) {
    await page.locator(`[data-testid="${railButtonTestid}"]`).click();
  }
  await expect(content).toBeVisible({ timeout: 15_000 });
}

/** Switch the Changes tab mode via its zone-header dropdown. */
export async function setChangesMode(page: Page, mode: 'session' | 'uncommitted' | 'branch'): Promise<void> {
  await page.locator('[data-testid="zone-button-tab-dropdown"]').click();
  await page.locator(`[data-testid="zone-tab-dropdown-option-${mode}"]`).click();
}
