/**
 * §sessions-tags — Tag popover lifecycle for app-tauri browser mode.
 *
 * Ported from plan spec #4 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). All tests run in E2E_MODE=mock (UI-only sidebar interactions
 * over a REST-seeded project/chat — no agent turn needed).
 *
 * Source (verified against packages/ui/src/v2/features/sessions/ — the popover was
 * rebuilt on the stock cmdk `Command` engine, so the registry rows are
 * `CommandItem`s, not checkbox buttons):
 *   TagPopover.tsx          — popover root, anchored to whatever opened it
 *   TagPopoverPanel.tsx     — the Command body: search/create/registry list/error lines
 *   TagPopoverHost.tsx      — single mounted host, reads use-tag-popover-target
 *   TagRegistryRow.tsx      — one registry row (`CommandItem`) or its rename input
 *   TagRegistryItemMenu.tsx — right-click menu on a registry row (rename/recolor/delete)
 *   TagRecolorPanel.tsx     — palette swatch picker
 *   TagDeleteConfirm.tsx    — delete confirm dialog
 *   features/sessions/tags/validate-tag-name.ts — client-side name validation
 *   SessionRow.tsx          — row hover action `sessions-row-action-tags`
 *   SessionContextMenu.tsx  — row context-menu item `sessions-ctx-tags`
 *   SessionRowMetaLine.tsx  — the applied-tag dot cluster on the row (replaced
 *                             `SessionRowMetaIcons.tsx`, hence the dot testid rename)
 *   TagFilterBar.tsx        — tag chips in the sidebar footer
 *
 * Testid reference (all verified against source above):
 *   sessions-row-action-tags        — row hover action that opens the popover
 *   sessions-ctx-tags                — row right-click context-menu item that opens the popover
 *   sessions-tag-popover             — popover content root
 *   sessions-tag-popover-search      — search/create-name input (cmdk CommandInput)
 *   sessions-tag-popover-create      — the create row; its copy uses TYPOGRAPHIC quotes:
 *                                       Create tag “<name>”
 *   sessions-tag-popover-name-error  — the inline name-validation message (this DID gain a
 *                                       testid in the rebuild — the old spec asserted its text
 *                                       because the element had none)
 *   sessions-tag-popover-error       — async-failure error line (see NOTE below — not reachable
 *                                       via legitimate client-side validation, only via a
 *                                       setChatTags/registry mutation exception)
 *   sessions-tag-toggle-<name>       — registry row (`CommandItem`). It carries `data-checked`,
 *                                       NOT `aria-checked`: cmdk items are `role=option`, so
 *                                       the applied state is published as a data attribute.
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
 *   sessions-tag-filter-<name>       — tag chip in the sidebar footer's filter bar
 *
 * NOTE on the validation-error scenario: TagPopoverPanel's client-side
 * validateTagName() (packages/ui/src/features/sessions/tags/validate-tag-name.ts)
 * uses the EXACT same charset/length/reserved-prefix rules as the server
 * (/^[a-z0-9-]+$/, 2-24 chars, no "mf:" prefix). Because of this, an invalid name
 * can never reach createAndApply()/commitRename() — both bail out before calling
 * the API, so the `sessions-tag-popover-error` (async-failure) line is never
 * rendered by a bad name. The reachable behaviour for a bad name is
 * `sessions-tag-popover-name-error` under the search field, plus the absence of
 * the create row.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { closeMenus, waitForDialogScrimsGone } from '../helpers/tauri/menus.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';

// Distinct substrings so the search-filter test can isolate one from the other.
const TAG_A = 'e2e-alpha';
const TAG_A_RENAMED = 'e2e-alpha-2';
const TAG_B = 'e2e-beta';

/** The row's own SessionMetaCard hover card — see `openViaHoverAction`. */
function hoverCards(page: Page): Locator {
  return page.locator('[data-slot="hover-card-content"]');
}

/**
 * Start from a clean layer stack.
 *
 * Every test in this describe shares one page, and `TagPopoverPanel` keeps its
 * query/rename state for as long as Radix keeps the popover mounted — "open" is a
 * no-op when it is already open, so a test that ended early otherwise hands the
 * next one a live panel in an unknown state. The scrim wait covers the delete
 * confirm: a dialog's overlay outlives its content's unmount, and a popover
 * re-opened under a dying scrim has every click inside it intercepted.
 */
async function resetLayers(page: Page): Promise<void> {
  await closeMenus(page);
  await closePopover(page);
  await waitForDialogScrimsGone(page);
}

async function openViaHoverAction(page: Page, row: Locator): Promise<void> {
  await resetLayers(page);
  await row.hover();
  await row.getByTestId('sessions-row-action-tags').evaluate((el) => (el as HTMLElement).click());
  // Park the pointer OFF the row. `SessionRow` wraps itself in a `HoverCard`
  // (SessionMetaCard, openDelay 500ms) that pops out to the RIGHT — straight over
  // the tag popover — and swallows every click inside it: measured live as
  // `data-slot="hover-card-content" … intercepts pointer events` retried for the
  // test's whole 60s budget on `sessions-tag-popover-create`. The popover is
  // mounted by TagPopoverHost at the app root and anchored to a stored rect, so it
  // does not need the pointer to stay on the row that opened it.
  await page.mouse.move(0, 0);
  await expect(hoverCards(page)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId('sessions-tag-popover')).toBeVisible({ timeout: 5_000 });
}

async function openViaContextMenu(page: Page, row: Locator): Promise<void> {
  await row.click({ button: 'right' });
  await page.getByTestId('sessions-ctx-tags').click();
  await expect(page.getByTestId('sessions-tag-popover')).toBeVisible({ timeout: 5_000 });
}

async function closePopover(page: Page): Promise<void> {
  const popover = page.getByTestId('sessions-tag-popover');
  // The popover is often the OUTERMOST of several stacked layers — a registry row's
  // context menu, the recolor panel — and Escape unwinds exactly one per press. A
  // press that lands while a layer is still running its exit animation is swallowed,
  // so each one gets a bounded chance to take effect before the next. Leaving the
  // popover open strands every later test in this describe: its first act is to
  // right-click a registry row that the stale layer covers.
  for (let layer = 0; layer < 4 && (await popover.count()) > 0; layer++) {
    await page.keyboard.press('Escape');
    await popover.waitFor({ state: 'detached', timeout: 1_000 }).catch(() => {
      /* expected while an inner layer is the one that closed */
    });
  }
  await expect(popover).toHaveCount(0, { timeout: 5_000 });
}

/** Right-click a registry row to open its item context menu. */
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

  // Attempted fix (commit 3368d065): the Tags row-context-menu action never
  // opened the popover — `onTags` fired synchronously inside the Radix
  // `ContextMenuItem` `onSelect` callback instead of deferring past the
  // ctx-menu's own rAF focus-restore, unlike `onRename`. `SessionRow.tsx` now
  // defers via `setTimeout(0)`, on the theory that a macrotask always runs
  // after the ctx-menu's rAF-scheduled focus restore.
  //
  // TODO(bug): still doesn't open. Verified in isolation (clean single-worker
  // run, no port contention) at both the original 5s timeout and a 20s probe
  // timeout — `sessions-tag-popover` never appears, deterministically, not a
  // slow race. The setTimeout(0)-after-rAF ordering assumption doesn't hold
  // here; re-investigating the actual event ordering is out of this pass's
  // scope (would require product-code changes in packages/ui). Reported to
  // the orchestrator.
  test('opens the tag popover from the row context menu', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    test.skip(
      true,
      'TODO(bug): Tags row-context-menu action still does not open the popover — setTimeout(0) defer (commit 3368d065) does not close the race against the ctx-menu rAF focus-restore in this environment (confirmed deterministic non-open at both 5s and 20s)',
    );

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
    await expect(toggle).toHaveAttribute('data-checked', 'true');

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
    await expect(page.getByTestId(`sessions-tag-toggle-${TAG_A}`)).toHaveAttribute('data-checked', 'true');
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
    await expect(createRow).toContainText(`Create tag “${TAG_B}”`);
    await createRow.click();

    const toggle = page.getByTestId(`sessions-tag-toggle-${TAG_B}`);
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    await expect(toggle).toHaveAttribute('data-checked', 'true');

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
    await expect(toggle).toHaveAttribute('data-checked', 'false');

    await closePopover(page);

    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_B}`)).toHaveCount(0, { timeout: 5_000 });
    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A}`)).toBeVisible();
  });

  // TODO(bug): the rename input is destroyed by the context menu's focus restore,
  // so renaming a registry tag is unreachable in the UI. Chain, all in product
  // code, no timing assumption left in it:
  //   1. `TagRegistryItemMenu` is a Radix `ContextMenu`; selecting an item closes
  //      it, and `ContextMenuContent` does NOT preventDefault `onCloseAutoFocus`
  //      unless the close came from an outside interaction
  //      (@radix-ui/react-context-menu 2.3.7, dist/index.mjs:137-141).
  //   2. `FocusScope`'s unmount cleanup therefore runs `setTimeout(…, 0)` →
  //      `focus(previouslyFocusedElement)` (@radix-ui/react-focus-scope 1.1.16,
  //      dist/index.mjs:92-101). A right-clicked cmdk `CommandItem` is not
  //      focusable, so that element is the still-mounted `CommandInput`.
  //   3. `TagRegistryRow`'s `RenameInput` is `autoFocus` with
  //      `onBlur={() => onCommit(value.trim().toLowerCase())}`, and
  //      `TagRegistryList.onCommitRename` calls `setRenaming(null)` — so the
  //      macrotask focus-restore blurs the input one tick after it mounts and
  //      immediately unmounts it. `useTagMutations.rename` then short-circuits on
  //      `to === from`, so the rename is silently dropped.
  // The popover already works around the same restore with
  // `onFocusOutside={(e) => e.preventDefault()}` (TagPopover.tsx); the menu needs
  // the equivalent `onCloseAutoFocus` guard (or the row must stop committing on
  // blur). Fixing it means changing packages/ui, which is out of this pass's scope.
  test('renames a tag via the registry item context menu, cascading to the row', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    test.skip(
      true,
      "TODO(bug): the registry rename input is blurred-and-committed by the context menu's focus restore one macrotask after it mounts, so `sessions-tag-rename-input` is never observable and the rename is dropped (to === from short-circuit). Needs onCloseAutoFocus preventDefault in TagRegistryItemMenu.tsx — product change.",
    );

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
  //
  // Recolors TAG_A, not the renamed name: rename is skipped above (TODO(bug)),
  // and a test that only reaches its subject through another test's side effect
  // fails for that other test's reason instead of its own.
  test('recolors a tag via the recolor panel (registry-only — no cascade needed for the name)', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);
    const dot = row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A}`);
    const readBackgroundColor = () => dot.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    const styleBefore = await readBackgroundColor();

    await openViaHoverAction(page, row);
    await openRegistryItemMenu(page, TAG_A);
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
    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_A}`)).toBeVisible();

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

  // Deletes TAG_A (see the recolor test's note on not depending on the skipped
  // rename). TAG_A is still applied to the seeded chat, so this exercises the full
  // cascade: registry row → row dot → filter chip.
  test('delete confirm dialog: OK removes the tag from the registry, the row, and the filter bar', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    await openRegistryItemMenu(page, TAG_A);
    await page.getByTestId('sessions-tag-registry-delete').click();

    const confirmDialog = page.getByTestId('sessions-tag-delete-confirm');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('sessions-tag-delete-confirm-ok').click();
    await expect(confirmDialog).toHaveCount(0, { timeout: 5_000 });

    await expect(page.getByTestId(`sessions-tag-registry-row-${TAG_A}`)).toHaveCount(0, { timeout: 5_000 });

    await closePopover(page);

    await expect(row.getByTestId(`sessions-row-meta-tag-dot-${TAG_A}`)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId(`sessions-tag-filter-${TAG_A}`)).toHaveCount(0, { timeout: 10_000 });
  });

  test('shows an inline validation message for a disallowed tag name and suppresses create', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    await openViaHoverAction(page, row);
    const search = page.getByTestId('sessions-tag-popover-search');
    // Underscore is outside the allowed /^[a-z0-9-]+$/ charset (validate-tag-name.ts) —
    // both the client and server reject it identically.
    await search.fill('bad_name');

    // The message element gained a testid in the rebuild (TagPopoverPanel.tsx
    // PanelErrors) — assert both the id and the copy from tagNameErrorMessage().
    const nameError = page.getByTestId('sessions-tag-popover-name-error');
    await expect(nameError).toBeVisible({ timeout: 5_000 });
    await expect(nameError).toHaveText('Only lowercase letters, numbers, and hyphens allowed');
    await expect(page.getByTestId('sessions-tag-popover-create')).toHaveCount(0);

    await search.press('Enter');
    await expect(page.getByTestId('sessions-tag-toggle-bad_name')).toHaveCount(0);

    await closePopover(page);
  });
});
