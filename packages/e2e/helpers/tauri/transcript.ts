import { expect, type Locator, type Page } from '@playwright/test';

/** One step of a turn: a row of the transcript, by the tool it stands for. */
export function toolRow(scope: Page | Locator, tool: string): Locator {
  return scope.locator(`[data-tool="${tool}"]`);
}

/** A row's own disclosure. The first one inside: a sub-agent's row holds its steps' too. */
const disclosure = (row: Locator): Locator => row.locator('[aria-expanded]').first();

export async function openRow(row: Locator): Promise<void> {
  const toggle = disclosure(row);
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

export async function expectRowClosed(row: Locator): Promise<void> {
  await expect(disclosure(row)).toHaveAttribute('aria-expanded', 'false');
}

/** The work rows of the turns on screen, in order. */
export function workRows(page: Page): Locator {
  return page.locator('[data-testid^="chat-work-toggle-"]');
}

/** Opens a turn's work; a turn folds by itself once it has ended. The last one by default. */
export async function openWork(page: Page, index = -1): Promise<void> {
  const toggle = index < 0 ? workRows(page).last() : workRows(page).nth(index);
  await toggle.waitFor({ timeout: 60_000 });
  // A turn that has just ended is open for a moment more, unless something in it holds it open.
  const end = await toggle.locator('xpath=..').getAttribute('data-work-end');
  if (end !== 'running' && end !== 'needs-you')
    await expect(toggle)
      .toHaveAttribute('aria-expanded', 'false', { timeout: 2_000 })
      .catch(() => {});
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}
