/**
 * §sessions-tags — Tag popover lifecycle for app-tauri browser mode.
 *
 * Ported from plan spec #4 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). All tests run in E2E_MODE=mock (UI-only sidebar interactions
 * over a REST-seeded project/chat — no agent turn needed).
 *
 * Source (verified against packages/ui/src/features/sessions/):
 *   tags/TagPopover.tsx          — popover root (search/create/registry list/error line)
 *   tags/TagPopoverHost.tsx      — single mounted host, reads use-tag-popover-target
 *   tags/TagRegistryItemMenu.tsx — right-click menu on a registry row (rename/recolor/delete)
 *   tags/TagRecolorPanel.tsx     — palette swatch picker
 *   tags/TagDeleteConfirm.tsx    — delete confirm dialog
 *   tags/validate-tag-name.ts    — client-side name validation (mirrors core/src/lib/validate-tag-name.ts)
 *   sidebar/SessionRow.tsx       — row hover action `sessions-row-action-tags`
 *   sidebar/SessionContextMenu.tsx — row context-menu item `sessions-ctx-tags`
 *   sidebar/SessionRowMeta.tsx   — applied-tag dot cluster on the row
 *   filter/TagFilterBar.tsx      — tag pills in the sidebar filter bar
 *
 * Testid reference (all verified against source above):
 *   sessions-row-action-tags        — row hover action that opens the popover
 *   sessions-ctx-tags                — row right-click context-menu item that opens the popover
 *   sessions-tag-popover             — popover content root
 *   sessions-tag-popover-search      — search/create-name input
 *   sessions-tag-popover-create      — "Create tag "<name>"" row
 *   sessions-tag-popover-error       — async-failure error line (see NOTE below — not reachable
 *                                       via legitimate client-side validation, only via a
 *                                       setChatTags/registry mutation exception)
 *   sessions-tag-toggle-<name>       — registry row checkbox button (role=checkbox, aria-checked)
 *   sessions-tag-registry-row-<name> — registry row name label (search-filter target)
 *   sessions-tag-registry-rename     — registry item context-menu: Rename
 *   sessions-tag-registry-recolor    — registry item context-menu: Change color
 *   sessions-tag-registry-delete     — registry item context-menu: Delete from all sessions
 *   sessions-tag-rename-input        — inline rename input (replaces the registry row)
 *   sessions-tag-recolor-panel       — recolor swatch panel root
 *   sessions-tag-color-<c>           — a palette swatch button (TAG_PALETTE from mainframe-types)
 *   sessions-tag-delete-confirm      — delete confirm dialog root
 *   sessions-tag-delete-confirm-cancel / -ok — dialog buttons
 *   sessions-row-meta-tag-dot-<name> — applied-tag dot on the row meta line
 *   sessions-tag-filter-<name>       — tag pill in the sidebar filter bar
 *
 * NOTE on the validation-error scenario: TagPopover's client-side
 * validateTagName() (packages/ui/src/features/sessions/tags/validate-tag-name.ts)
 * uses the EXACT same charset/length/reserved-prefix rules as the server
 * (packages/core/src/lib/validate-tag-name.ts: /^[a-z0-9-]+$/, 2-24 chars,
 * no "mf:" prefix). Because of this, an invalid name can never reach
 * createAndApply()/commitRename() — both bail out before calling the API, so
 * the `sessions-tag-popover-error` (async-failure) line is never rendered by
 * a bad name. The reachable, source-verified behaviour for a bad name is the
 * inline message rendered directly under the search field (no data-testid on
 * that element — asserted here by its exact text from tagNameErrorMessage()),
 * plus the absence of the create row. See the report for the punch-list note.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';

// Distinct substrings so the search-filter test can isolate one from the other.
const TAG_A = 'e2e-alpha';
const TAG_A_RENAMED = 'e2e-alpha-2';
const TAG_B = 'e2e-beta';

async function openViaHoverAction(page: Page, row: Locator): Promise<void> {
  await row.hover();
  await row.getByTestId('sessions-row-action-tags').evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByTestId('sessions-tag-popover')).toBeVisible({ timeout: 5_000 });
}

async function openViaContextMenu(page: Page, row: Locator): Promise<void> {
  await row.click({ button: 'right' });
  await page.getByTestId('sessions-ctx-tags').click();
  await expect(page.getByTestId('sessions-tag-popover')).toBeVisible({ timeout: 5_000 });
}

async function closePopover(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sessions-tag-popover')).toHaveCount(0, { timeout: 5_000 });
}

/** Right-click a registry row's checkbox to open its item context menu. */
async function openRegistryItemMenu(page: Page, name: string): Promise<void> {
  await page.getByTestId(`sessions-tag-toggle-${name}`).click({ button: 'right' });
  await expect(page.getByTestId('sessions-tag-registry-rename')).toBeVisible({ timeout: 5_000 });
}

test.describe('§sessions-tags Tag popover lifecycle', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('opens the tag popover from the row hover action', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    await expect(page.getByTestId('sessions-tag-popover-search')).toBeVisible();

    await closePopover(page);
  });

  // FIXED (commit 3368d065): the Tags row-context-menu action never opened the
  // popover — `onTags` fired synchronously inside the Radix `ContextMenuItem`
  // `onSelect` callback instead of deferring past the ctx-menu's own rAF
  // focus-restore, unlike `onRename`. `SessionRow.tsx` now defers via
  // `setTimeout(0)`, so the popover opens reliably from the context-menu path.
  test('opens the tag popover from the row context menu', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaContextMenu(page, row);
    await expect(page.getByTestId('sessions-tag-popover-search')).toBeVisible();

    await closePopover(page);
  });

  test('creates a tag via type + Enter and applies it immediately', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    const search = page.getByTestId('sessions-tag-popover-search');
    await search.fill(TAG_A);
    await search.press('Enter');

    // createAndApply resolves and clears the query — the toggle row reappears
    // (unfiltered) checked.
    const toggle = page.getByTestId(`sessions-tag-toggle-${TAG_A}`);
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await closePopover(page);

    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A}`)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId(`sessions-tag-filter-${TAG_A}`)).toBeVisible({ timeout: 10_000 });
  });

  test('an applied tag survives a page reload (daemon-persisted)', async () => {
    const { page } = app;

    await page.reload();
    await waitConnected(page);

    const row = sessionsSidebar(page).row(chatId);
    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A}`)).toBeVisible({ timeout: 10_000 });

    await openViaHoverAction(page, row);
    await expect(page.getByTestId(`sessions-tag-toggle-${TAG_A}`)).toHaveAttribute('aria-checked', 'true');
    await closePopover(page);
  });

  test('creates a second tag via the create row and applies it', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    const search = page.getByTestId('sessions-tag-popover-search');
    await search.fill(TAG_B);

    const createRow = page.getByTestId('sessions-tag-popover-create');
    await expect(createRow).toBeVisible({ timeout: 5_000 });
    await expect(createRow).toContainText(`Create tag "${TAG_B}"`);
    await createRow.click();

    const toggle = page.getByTestId(`sessions-tag-toggle-${TAG_B}`);
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await closePopover(page);

    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A}`)).toBeVisible();
    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_B}`)).toBeVisible();
  });

  test('search field filters the registry list', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    const search = page.getByTestId('sessions-tag-popover-search');

    await search.fill('alpha');
    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_A}`)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_B}`)).toHaveCount(0);

    await search.fill('');
    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_A}`)).toBeVisible();
    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_B}`)).toBeVisible();

    await closePopover(page);
  });

  test('toggles a tag off, removing its dot from the row', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    const toggle = page.getByTestId(`sessions-tag-toggle-${TAG_B}`);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await closePopover(page);

    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_B}`)).toHaveCount(0, { timeout: 5_000 });
    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A}`)).toBeVisible();
  });

  test('renames a tag via the registry item context menu, cascading to the row', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    await openRegistryItemMenu(page, TAG_A);
    await page.getByTestId('sessions-tag-registry-rename').click();

    const renameInput = page.getByTestId('sessions-tag-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill(TAG_A_RENAMED);
    await renameInput.press('Enter');

    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_A_RENAMED}`)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_A}`)).toHaveCount(0);

    await closePopover(page);

    // Rename cascades to every thread carrying the old name (spec §5.5).
    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A_RENAMED}`)).toBeVisible({ timeout: 10_000 });
    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A}`)).toHaveCount(0);
    await expect(page.getByTestId(`sessions-tag-filter-${TAG_A_RENAMED}`)).toBeVisible({ timeout: 10_000 });
  });

  // Previously: a registry-only recolor never updated the row's tag dot color
  // (`SessionSidebar.tsx` and `TagPopoverHost.tsx` each held their own
  // independent `useTagRegistry` instance with no cross-invalidation). Fixed
  // by the product-bug-fix campaign; the dot now picks up the new color.
  test('recolors a tag via the recolor panel (registry-only — no cascade needed for the name)', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);
    const dot = row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A_RENAMED}`);
    const readBackgroundColor = () => dot.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    const styleBefore = await readBackgroundColor();

    await openViaHoverAction(page, row);
    await openRegistryItemMenu(page, TAG_A_RENAMED);
    await page.getByTestId('sessions-tag-registry-recolor').click();

    const panel = page.getByTestId('sessions-tag-recolor-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    const redSwatch = page.getByTestId('sessions-tag-color-red');
    // Read the swatch's own rendered color before clicking it — comparing the dot
    // to this DOM-observed value (not a hardcoded oklch string) avoids coupling
    // the assertion to browser-specific oklch() serialization.
    const redSwatchColor = await redSwatch.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    expect(redSwatchColor).not.toBe('');
    await redSwatch.click();

    // Recolor closes the panel but leaves the popover + registry row open.
    await expect(panel).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_A_RENAMED}`)).toBeVisible();

    await closePopover(page);

    await expect(dot).toBeVisible({ timeout: 5_000 });
    await expect.poll(readBackgroundColor, { timeout: 10_000 }).not.toBe(styleBefore);
    await expect.poll(readBackgroundColor, { timeout: 5_000 }).toBe(redSwatchColor);
  });

  test('delete confirm dialog: Cancel keeps the tag in the registry', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    await openRegistryItemMenu(page, TAG_B);
    await page.getByTestId('sessions-tag-registry-delete').click();

    const confirmDialog = page.getByTestId('sessions-tag-delete-confirm');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await expect(confirmDialog).toContainText(TAG_B);

    await page.getByTestId('sessions-tag-delete-confirm-cancel').click();
    await expect(confirmDialog).toHaveCount(0, { timeout: 5_000 });

    // Popover re-opens (confirmDelete cleared, target unchanged) with the row intact.
    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_B}`)).toBeVisible({ timeout: 5_000 });

    await closePopover(page);
  });

  test('delete confirm dialog: OK removes the tag from the registry, the row, and the filter bar', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    await openRegistryItemMenu(page, TAG_A_RENAMED);
    await page.getByTestId('sessions-tag-registry-delete').click();

    const confirmDialog = page.getByTestId('sessions-tag-delete-confirm');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('sessions-tag-delete-confirm-ok').click();
    await expect(confirmDialog).toHaveCount(0, { timeout: 5_000 });

    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_A_RENAMED}`)).toHaveCount(0, { timeout: 5_000 });

    await closePopover(page);

    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A_RENAMED}`)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId(`sessions-tag-filter-${TAG_A_RENAMED}`)).toHaveCount(0, { timeout: 10_000 });
  });

  test('shows an inline validation message for a disallowed tag name and suppresses create', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    const search = page.getByTestId('sessions-tag-popover-search');
    // Underscore is outside the allowed /^[a-z0-9-]+$/ charset (validate-tag-name.ts) —
    // both the client and server reject it identically.
    await search.fill('bad_name');

    await expect(
      page.getByTestId('sessions-tag-popover').getByText('Only lowercase letters, numbers, and hyphens allowed'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('sessions-tag-popover-create')).toHaveCount(0);

    await search.press('Enter');
    await expect(page.getByTestId('sessions-tag-toggle-bad_name')).toHaveCount(0);

    await closePopover(page);
  });
});
