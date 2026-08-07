/**
 * §chat-header — ChatCardHeader (the chat surface's own header row) specs.
 *
 * Cluster B, spec #14 of docs/plans/2026-07-03-tauri-e2e-test-plan.md. New surface
 * (no legacy 1:1 predecessor) — covers the model chip, the worktree-gated Review
 * button, the split-right/split-down controls, and the dynamic-floor Hide-Chat
 * control. The context meter left this header in the right-sidebar revamp (T5.5);
 * see session-panel.spec.ts.
 *
 * Source read: packages/ui/src/features/chat/thread/{ChatCardHeader,ChatSessionInline}.tsx,
 * packages/ui/src/store/layout.ts, packages/ui/src/store/intent-subscriber.ts,
 * packages/ui/src/features/review/ReviewPanel.tsx, packages/core/src/server/routes/worktree.ts.
 *
 * A concurrent session was landing header changes for draft-chat (welcome-flow)
 * rendering while this spec was written (`ChatCardHeaderDraft` in the same file).
 * That branch is orthogonal to this spec — every scenario below operates on a
 * REAL (non-draft) chat, which always renders `ChatCardHeaderReal`.
 *
 * Testid reference (all verified against source):
 *   chat-header                — header root (real chat)
 *   chat-header-model           — adapter dot + model label (ChatSessionInline part="model")
 *   chat-header-pr-<number>     — per-PR chip (needs PR detection — unseedable, see skip below)
 *   chat-header-split-right     — place the Workspace beside Chat in the top row
 *   chat-header-split-down      — dock the Workspace in the bottom strip
 *   chat-header-hide            — hide the Chat surface (disabled at the dynamic floor)
 *   (review entry moved to the session panel's Changes row + Cmd/Ctrl+Shift+R —
 *    modal coverage lives in review-panel.spec.ts)
 *   surface-rail-<chat|workspace> / workspace-surface / workspace-surface-close — layout.spec.ts's
 *                                  own testids, referenced here only to observe split/hide effects
 *   [data-drop-surface="chat|workspace"] — layout engine's per-surface panel wrapper
 *
 * SurfaceId is 'chat' | 'workspace' since the 2026-08-05 Files+Run merge, so there
 * is exactly one surface to split to and the split controls unmount once it is placed
 * (packages/ui/CLAUDE.md, "Surface model").
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

// ─── Model chip ───────────────────────────────────────────────────────────────
//
// The context meter that used to share this describe is GONE (right-sidebar
// revamp, T5.5): the header no longer reports context fill — the session panel's
// Summary row does. Its coverage moved verbatim to session-panel.spec.ts's
// "§session-panel — Summary rows", which is why that file carries the
// `chat-status` recording this describe no longer needs.

test.describe('§chat-header — model chip', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // Previously: the mock-cli chat created above has no explicit `model`, so
  // `chat.model` is null (a documented-valid state — the session inherits the
  // adapter default). `ChatSessionInline` looked up `chat.model` directly with
  // no `isDefault` fallback (unlike `useComposerTuning`'s resolution chain),
  // so the chip never mounted pre-turn. Fixed by the product-bug-fix campaign
  // — `ChatSessionInline` now falls back to `adapter.models.find(isDefault)`.
  test('model chip renders once chat config loads, before any turn', async () => {
    const { page } = app;

    const chip = page.getByTestId('chat-header-model');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    const text = await chip.textContent();
    expect(text?.trim().length ?? 0).toBeGreaterThan(0);
  });
});

// ─── Review button (worktree gate) ────────────────────────────────────────────

// ─── Hide-Chat control (dynamic floor) ────────────────────────────────────────

test.describe('§chat-header — hide-chat control (dynamic floor)', () => {
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

  test('disabled while Chat is the only lit surface', async () => {
    const { page } = app;
    await expect(page.getByTestId('chat-header-hide')).toBeDisabled();
  });

  test('enabled once Files is lit (⌘/Ctrl+2), and hides the chat surface when clicked', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+2');
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    const hideButton = page.getByTestId('chat-header-hide');
    await expect(hideButton).toBeEnabled();
    await hideButton.click();

    await expect(page.locator('[data-drop-surface="chat"]')).toHaveCount(0);
    await expect(page.getByTestId('chat-header')).toHaveCount(0);
    // Files remains the sole lit surface.
    await expect(page.getByTestId('workspace-surface')).toBeVisible();
  });
});

// ─── Split controls ────────────────────────────────────────────────────────────

test.describe('§chat-header — split controls', () => {
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

  /**
   * With two surfaces there is exactly one thing to split TO, so `layoutCanSplit`
   * (store/layout-placement.ts) is false the moment the workspace is placed and the
   * split controls unmount. Hiding it un-places it and brings them back.
   */
  async function collapseToChatOnly(page: Page): Promise<void> {
    const hideWorkspace = page.getByTestId('workspace-surface-close');
    if ((await hideWorkspace.count()) > 0) await hideWorkspace.first().click();
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('chat-header-split-right')).toBeVisible();
  }

  test('split-right lights the workspace beside Chat in the top row', async () => {
    const { page } = app;
    await collapseToChatOnly(page);
    await page.getByTestId('chat-header-split-right').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    const chatBox = await page.locator('[data-drop-surface="chat"]').boundingBox();
    const workspaceBox = await page.locator('[data-drop-surface="workspace"]').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    // Same row: comparable y, Chat stays leftmost.
    expect(Math.abs(chatBox!.y - workspaceBox!.y)).toBeLessThan(5);
    expect(chatBox!.x).toBeLessThan(workspaceBox!.x);

    // Nothing left to split to — both controls go away until the workspace is hidden.
    await expect(page.getByTestId('chat-header-split-right')).toHaveCount(0);
    await expect(page.getByTestId('chat-header-split-down')).toHaveCount(0);
  });

  test('split-down docks the workspace in the bottom strip', async () => {
    const { page } = app;
    await collapseToChatOnly(page);
    await page.getByTestId('chat-header-split-down').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    const chatBox = await page.locator('[data-drop-surface="chat"]').boundingBox();
    const workspaceBox = await page.locator('[data-drop-surface="workspace"]').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    // The strip spans the full width below the top row, so Chat keeps the whole row.
    expect(workspaceBox!.y).toBeGreaterThan(chatBox!.y + chatBox!.height - 5);
    expect(Math.abs(workspaceBox!.x - chatBox!.x)).toBeLessThan(5);
  });
});

// ─── PR-link chips (unseedable in browser mode) ───────────────────────────────

test.describe('§chat-header — PR link chips', () => {
  test('PR chip renders for a chat with a detected PR', async () => {
    test.skip(
      true,
      'TODO(recording): chat-header-pr-<number> is driven by custom.detectedPrs, which is only ' +
        "populated by the daemon's PR-detection background service (reading git/gh against a real " +
        'remote). There is no REST route to seed it directly (grepped packages/core/src/server/routes ' +
        'for detectedPrs) and no recording can substitute for a git-remote/gh state. Needs either a ' +
        'REST test-seam or a live git+gh fixture to unskip.',
    );
  });
});
