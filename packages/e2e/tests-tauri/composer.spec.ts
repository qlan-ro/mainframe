import { test, expect } from '@playwright/test';
import { rmSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { sendMessage, waitConnected, waitForIdle } from '../helpers/tauri/wait.js';

// Minimal 1x1 red PNG — valid image, tiny payload
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

// ─── Composer config selects (ported from §44) ────────────────────────────────
test.describe('§composer config selects', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('M5: model select opens, lists models, and closes on pick', async () => {
    const { page } = app;
    await page.locator('[data-testid="composer-model-select"]').click();
    const options = page.locator('[data-testid^="composer-model-select-option-"]');
    await expect(options.first()).toBeVisible({ timeout: 5_000 });
    const count = await options.count();
    await options.nth(count - 1).click();
    await expect(options.first()).toHaveCount(0); // dropdown closed after pick
  });

  // TODO(bug): the `closeMenus()` before the reset click below is a WORKAROUND for a
  // real product wart, filed here because this is where it bites.
  //
  // Measured in Chromium (2026-08-06, throwaway Playwright probe reading the live DOM):
  // pick a mode, then click the chip again and the menu does NOT reopen — the trigger
  // stays `aria-expanded="false"`, `[role=menu]` count goes 1 → 0, and the very next
  // click opens it normally. The dropped click lands inside the window where Radix
  // still has the CLOSING menu's content mounted for its exit animation; waiting for
  // that content to unmount makes the reopen reliable every time. Not reproducible in
  // jsdom (a unit test of the same gesture passes), which is why no unit test caught it.
  //
  // For a user this reads as "the permission chip ignored my click" right after they
  // changed the mode. It is NOT a regression from the v2 port: PermissionSelect still
  // renders the v1 `components/ui/dropdown-menu` and has not changed since #460 — the
  // same swallow reproduces on any Tooltip-wrapped DropdownMenuTrigger in the composer
  // toolbar. Fixing it belongs in the primitive (or its Tooltip composition), not here;
  // when it is fixed, the `closeMenus()` on the reset click becomes redundant.
  test('M7: permission-mode select switches to Unattended (yolo)', async () => {
    const { page } = app;
    const trigger = page.locator('[data-testid="composer-permission-mode-select"]');
    await closeMenus();
    await trigger.click();
    await page.locator('[data-testid="composer-permission-mode-select-option-yolo"]').click();
    await expect(trigger).toContainText(/unattended/i, { timeout: 5_000 });
    // Reset to Interactive for cleanliness — only after the menu has actually
    // unmounted, per the TODO(bug) above.
    await closeMenus();
    await trigger.click();
    await page.locator('[data-testid="composer-permission-mode-select-option-default"]').click();
    await expect(trigger).toContainText(/interactive/i, { timeout: 5_000 });
  });

  test('M4: provider row is present and unlocked before the first message', async () => {
    const { page } = app;
    // The unified picker holds both provider + model. Open it via the model trigger.
    await page.locator('[data-testid="composer-model-select"]').click();
    const provider = page.locator('[data-testid^="composer-adapter-select-option-"]').first();
    await expect(provider).toBeVisible({ timeout: 5_000 });
    // Pre-message: the provider is selectable (not locked for the session).
    await expect(provider).toBeEnabled();
    // The footer always renders (ProviderModelSelect.tsx); before the first message it shows
    // the "pick a provider" hint, not the "Locked"/"stays fixed" copy.
    await expect(page.locator('[data-testid="composer-provider-footer"]')).toContainText(
      'Pick a provider before your first message.',
    );
    await closeMenus();
  });

  // Tuning writes (effort/features) now broadcast `chat.updated` (core `applyChatTuning` →
  // `ChatManager.emitChatUpdated`), so the server-authoritative composer chip reflects them.
  /**
   * Reach a state where a picker trigger is actually clickable. Two hazards, both
   * measured in a live browser (2026-08-06):
   *
   *  1. While a modal Radix menu is open, its overlay owns `<html>`'s pointer
   *     events, so a test that left a menu (or a model row's tuning flyout) open
   *     makes the next trigger click unhittable. Escape unwinds one layer per press.
   *  2. Radix keeps a CLOSING menu's content mounted through its exit animation, and
   *     a trigger click inside that window is SWALLOWED — the menu never reopens
   *     (`aria-expanded` stays false; the click after it works). So picking an item
   *     is not enough: wait until no `[role=menu]` is left in the DOM.
   */
  async function closeMenus(): Promise<void> {
    const { page } = app;
    const menus = page.locator('[role="menu"]');
    for (let layer = 0; layer < 4 && (await menus.count()) > 0; layer++) {
      await page.keyboard.press('Escape');
    }
    await expect(menus).toHaveCount(0, { timeout: 5_000 });
  }

  /**
   * Effort and options live in each model row's hover flyout now, not in their
   * own composer chips. Opens the model menu and reveals the first candidate
   * model's flyout; returns its id, or null when this environment exposes none.
   */
  async function openModelTuning(candidates: string[]): Promise<string | null> {
    const { page } = app;
    await closeMenus();
    await page.locator('[data-testid="composer-model-select"]').click();
    for (const id of candidates) {
      const row = page.locator(`[data-testid="composer-model-select-option-${id}"]`);
      if (!(await row.isVisible({ timeout: 2_000 }).catch(() => false))) continue;
      await row.hover();
      await expect(page.locator(`[data-testid="composer-model-${id}-tuning"]`)).toBeVisible({ timeout: 5_000 });
      return id;
    }
    return null;
  }

  // In mock mode the mock-cli exposes claude-opus-4-5-20251001 (xhigh+max) and
  // claude-sonnet-4-5-20251101 (no xhigh); record/live modes use bare names.
  const OPUS = ['claude-opus-4-5-20251001', 'opus'];
  const SONNET = ['claude-sonnet-4-5-20251101', 'sonnet'];
  const HAIKU = ['claude-haiku-4-5-20251001', 'haiku'];

  test("M6: a capable model's flyout lists its declared effort levels", async () => {
    const { page } = app;
    const id = await openModelTuning([...OPUS, ...SONNET]);
    if (id == null) {
      test.skip(true, 'no effort-capable model found in this environment');
      return;
    }

    await expect(page.locator(`[data-testid="composer-model-${id}-effort-low"]`)).toBeVisible({ timeout: 5_000 });
    const high = page.locator(`[data-testid="composer-model-${id}-effort-high"]`);
    await expect(high).toBeVisible();

    // Picking an effort keeps the menu open, and the level reads as checked.
    await high.click();
    await expect(high).toHaveAttribute('aria-checked', 'true');
  });

  test('M6b: an opus-level model exposes xhigh and max', async () => {
    const { page } = app;
    const id = await openModelTuning(OPUS);
    if (id == null) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }

    await expect(page.locator(`[data-testid="composer-model-${id}-effort-xhigh"]`)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="composer-model-${id}-effort-max"]`)).toBeVisible();
    await closeMenus();
  });

  test('M6c: haiku exposes no tuning flyout at all', async () => {
    const { page } = app;
    await closeMenus();
    await page.locator('[data-testid="composer-model-select"]').click();
    let found: string | null = null;
    for (const id of HAIKU) {
      const row = page.locator(`[data-testid="composer-model-select-option-${id}"]`);
      if (!(await row.isVisible({ timeout: 2_000 }).catch(() => false))) continue;
      await row.hover();
      found = id;
      break;
    }
    if (found == null) {
      test.skip(true, 'haiku model not found in this environment');
      return;
    }
    // No effort levels, no options — so the row is a plain item with no flyout.
    await expect(page.locator(`[data-testid="composer-model-${found}-tuning"]`)).toHaveCount(0);
    await closeMenus();
  });

  test('M6d: an opus-level model exposes all three options', async () => {
    const { page } = app;
    const id = await openModelTuning(OPUS);
    if (id == null) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }

    await expect(page.locator(`[data-testid="composer-model-${id}-feature-fast"]`)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="composer-model-${id}-feature-ultracode"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="composer-model-${id}-feature-adaptiveThinking"]`)).toBeVisible();
    await closeMenus();
  });

  test('M6e: enabling ultracode pins the effort to xhigh and freezes the levels', async () => {
    const { page } = app;
    const id = await openModelTuning(OPUS);
    if (id == null) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }

    const ultracode = page.locator(`[data-testid="composer-model-${id}-feature-ultracode"]`);
    await expect(ultracode).toBeVisible({ timeout: 5_000 });
    if ((await ultracode.getAttribute('aria-checked')) !== 'true') await ultracode.click();

    // The resolver coerces ultracode to xhigh, so the flyout shows it checked and
    // every level inert — the effort is no longer the user's to set.
    const xhigh = page.locator(`[data-testid="composer-model-${id}-effort-xhigh"]`);
    await expect(xhigh).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
    await expect(page.locator(`[data-testid="composer-model-${id}-effort-max"]`)).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await closeMenus();
  });

  test('M5b: a sonnet-level model offers max but not xhigh', async () => {
    const { page } = app;
    const id = await openModelTuning(SONNET);
    if (id == null) {
      test.skip(true, 'no sonnet-level model found in this environment');
      return;
    }

    await expect(page.locator(`[data-testid="composer-model-${id}-effort-max"]`)).toBeVisible({ timeout: 5_000 });
    // xhigh needs supportsUltracode, which sonnet does not advertise.
    await expect(page.locator(`[data-testid="composer-model-${id}-effort-xhigh"]`)).toHaveCount(0);
    await closeMenus();
  });
});

// ─── Composer attachments (ported from §30, non-AI tests only) ───────────────
test.describe('§composer attachments', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let testImagePath: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    testImagePath = path.join(project.projectPath, 'test-image.png');
    writeFileSync(testImagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('attaching an image shows thumbnail in composer', async () => {
    const { page } = app;

    const fileChooserPromise = page.waitForEvent('filechooser');
    // app-tauri uses testid `composer-add-attachment` instead of aria-label "Add attachment"
    await page.getByTestId('composer-add-attachment').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    // app-tauri uses `composer-attachment-tile` instead of `attachment-thumb`
    const thumb = page.locator('[data-testid="composer-attachment-tile"]');
    await thumb.waitFor({ timeout: 5_000 });
    await expect(thumb).toBeVisible();
  });

  test('removing attachment clears it from composer', async () => {
    const { page } = app;

    // Tile still visible from prior test
    const thumb = page.locator('[data-testid="composer-attachment-tile"]');
    await expect(thumb).toBeVisible();

    // Hover to reveal remove button, then click
    await thumb.hover();
    // app-tauri uses `composer-attachment-remove` instead of aria-label "Remove"
    await page.getByTestId('composer-attachment-remove').first().click();

    await expect(thumb).not.toBeVisible({ timeout: 3_000 });
  });

  // TODO(app-tauri): in-message image thumbnail (message-image-thumb) + AI attachment flow not verified yet
  test.skip('sending a message with attachment gets AI response', async () => {
    const { page } = app;

    // Re-attach
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('composer-add-attachment').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);
    await page.locator('[data-testid="composer-attachment-tile"]').waitFor({ timeout: 5_000 });

    // Skipped: message-image-thumb surface not ported to app-tauri yet
    const messageThumb = page.locator('[data-testid="message-image-thumb"]').first();
    await messageThumb.waitFor({ timeout: 10_000 });
    await expect(messageThumb).toBeVisible();
  });
});

// ─── Plan-mode toggle (§9a) ────────────────────────────────────────────────────
test.describe('§composer plan-mode toggle', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // PlanModeToggle.tsx returns null unless `adapter.capabilities.planMode` is true. Every
  // adapter registered in this suite (builtin claude/codex, plus mock-cli under E2E_MODE=mock —
  // verified in mainframe-adapter-mock/src/adapter.rs: `plan_mode: true`) declares
  // the capability, so there's no non-capable adapter here to assert the hidden branch against;
  // this exercises the visible/on path only.
  test('is visible for the plan-capable adapter and aria-pressed flips with active styling', async () => {
    const { page } = app;
    const toggle = page.getByTestId('composer-plan-toggle');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).not.toHaveClass(/border-primary/);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
    await expect(toggle).toHaveClass(/border-primary/);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 5_000 });
    await expect(toggle).not.toHaveClass(/border-primary/);
  });
});

// ─── Provider/model locked after the first message (§9b) ──────────────────────
test.describe('§composer provider locked after first message', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('sending the first message locks the provider row (Locked copy, disabled pills)', async () => {
    const { page } = app;
    await sendMessage(page, 'List the files in this project using bash ls.');
    await waitForIdle(page, 90_000);

    await page.locator('[data-testid="composer-model-select"]').click();
    await expect(page.locator('[data-testid="composer-provider-model-popover"]')).toBeVisible({ timeout: 5_000 });

    // ProviderModelSelect.tsx: `locked` = `thread.messages.length > 0` (ComposerToolbar's
    // hasMessages). The Lock-glyph header is gone — the provider row is a `Tabs` strip now, so
    // the lock reads as a disabled tab plus the footer copy, which switches from the
    // pre-message hint asserted in M4 above to the fixed-for-session copy.
    await expect(page.locator('[data-testid="composer-provider-footer"]')).toContainText(
      'Provider stays fixed for this session.',
    );

    // TabsTrigger `disabled = !installed || lockedOut`, where `lockedOut = installed && locked &&
    // id !== active` — the active provider (here mock-cli, createTauriChat's default adapterId
    // under E2E_MODE=mock) stays selectable as a no-op re-pick; every OTHER provider is inert.
    // `claude` is a builtin, always present in the adapter list. A locked-out INSTALLED provider
    // also gets a tooltip wrapper (`composer-adapter-locked-<id>`) explaining why; an uninstalled
    // one is disabled without it, so the wrapper is not asserted here.
    const otherProvider = page.locator('[data-testid="composer-adapter-select-option-claude"]');
    await expect(otherProvider).toBeVisible();
    await expect(otherProvider).toBeDisabled();

    await page.keyboard.press('Escape');
  });
});

// ─── Worktree-missing → degraded card locks composer (§9c) ────────────────────
test.describe('§composer worktree-missing degraded card', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;
  let worktreePath: string;
  const branchName = 'e2e-worktree-missing';

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');

    // Enable a worktree via the composer popover — real `git worktree add`, same flow as
    // composer-advanced.spec.ts's "§composer worktree setup" describe.
    const { page } = app;
    await page.getByTestId('composer-worktree-trigger').click();
    await expect(page.getByTestId('composer-worktree-tab-new')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('composer-worktree-branch-name').fill(branchName);
    await page.getByTestId('composer-worktree-enable').click();
    await expect(page.getByTestId('composer-worktree-popover')).toHaveCount(0, { timeout: 15_000 });

    // createWorktree() (packages/core/src/workspace/worktree.ts) resolves to
    // <projectPath>/<settings.general.worktreeDir, default '.worktrees'>/<branch, '/'→'-'>.
    // branchName has no '/', so the sanitized segment equals it verbatim.
    worktreePath = path.join(project.projectPath, '.worktrees', branchName);
    rmSync(worktreePath, { recursive: true, force: true });

    // is_worktree_present() (packages/core-rs/crates/mainframe-services/src/workspace/worktree.rs)
    // is a live fs check recomputed on every enrich_chat() — now joined by the generalized
    // directory check for the no-worktree case — so a reload + reselect is enough to pick up
    // worktreeMissing:true with no daemon restart needed.
    await page.reload();
    await waitConnected(page);
    await sessionsSidebar(page).row(chatId).click();
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('shows the degraded-chat card with recovery actions and hides the composer', async () => {
    const { page } = app;
    // The old chat-composer-worktree-missing banner was replaced by the
    // thread-level DegradedChatCard (unified transcript/worktree recovery), which now lives in
    // the sticky footer and takes the composer's slot instead of disabling it.
    const card = page.getByTestId('chat-degraded-card');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Worktree deleted');
    await expect(card).toContainText(worktreePath);
    await expect(page.getByTestId('chat-degraded-recreate-worktree')).toBeVisible();
    await expect(page.getByTestId('chat-degraded-project-root')).toBeVisible();
    await expect(page.getByTestId('chat-degraded-delete')).toBeVisible();
    await expect(page.getByTestId('chat-composer-worktree-missing')).toHaveCount(0);

    await expect(page.getByTestId('chat-thread-footer').getByTestId('chat-degraded-card')).toHaveCount(1);
    await expect(page.getByTestId('chat-composer')).toHaveCount(0);
  });
});
