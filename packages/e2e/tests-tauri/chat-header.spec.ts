/**
 * §chat-header — ChatCardHeader (the chat surface's own header row) specs.
 *
 * Cluster B, spec #14 of docs/plans/2026-07-03-tauri-e2e-test-plan.md. New surface
 * (no legacy 1:1 predecessor) — covers the model chip, the context meter +
 * percentage, the worktree-gated Review button, the split-right/split-down
 * controls, and the dynamic-floor Hide-Chat control.
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
 *   chat-header-context         — 8-segment context meter (part="status")
 *   chat-header-context-pct     — context percentage text, e.g. "42%"
 *   chat-header-review          — Review button, disabled without a worktree
 *   chat-header-pr-<number>     — per-PR chip (needs PR detection — unseedable, see skip below)
 *   chat-header-split-right     — split Files/Run beside Chat in the top row
 *   chat-header-split-down      — split Files/Run into the bottom strip
 *   chat-header-hide            — hide the Chat surface (disabled at the dynamic floor)
 *   review-modal                — the Review panel opened by chat-header-review
 *   surface-rail-<chat|files|run> / files-surface / run-surface — layout.spec.ts's own
 *                                  testids, referenced here only to observe split/hide effects
 *   [data-drop-surface="chat|files|run"] — layout engine's per-surface panel wrapper
 */
import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

// ─── Model chip + context meter (needs the `chat-status` recording) ──────────

test.describe('§chat-header — model chip + context meter', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'chat-status' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('model chip renders once chat config loads, before any turn', async () => {
    const { page } = app;
    const chip = page.getByTestId('chat-header-model');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    const text = await chip.textContent();
    expect(text?.trim().length ?? 0).toBeGreaterThan(0);

    // No usage data yet — the context meter must not render.
    await expect(page.getByTestId('chat-header-context')).toHaveCount(0);
  });

  test('context meter and percentage appear after a turn, with a positive percentage', async () => {
    const { page } = app;
    // Same prompt as the legacy §32 chat-status-context spec — the recording replays
    // an onMessage + onResult carrying real usage numbers for this exact turn.
    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');
    await waitForIdle(page, 60_000);

    const meter = page.getByTestId('chat-header-context');
    const pct = page.getByTestId('chat-header-context-pct');
    await expect(meter).toBeVisible({ timeout: 10_000 });
    await expect(pct).toBeVisible();

    // Assert the percentage is a real positive number, not a specific tier —
    // the tier boundaries (50/75/90%) are an implementation detail of segmentColor.
    const text = await pct.textContent();
    expect(text).toMatch(/^\d+%$/);
    const value = Number(text!.replace('%', ''));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(100);
  });
});

// ─── Review button (worktree gate) ────────────────────────────────────────────

test.describe('§chat-header — review button (worktree gate)', () => {
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

  test('review button is disabled without a worktree', async () => {
    const { page } = app;
    await expect(page.getByTestId('chat-header-review')).toBeDisabled();
  });

  test('enabling a worktree enables the review button; clicking it opens the review modal', async () => {
    const { page } = app;
    const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}/enable-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseBranch: 'main', branchName: 'e2e-review-header' }),
    });
    expect(res.ok).toBe(true);

    // `chat.updated` broadcasts live — no reload needed (see config-manager.ts applyWorktreeUpdate).
    const reviewButton = page.getByTestId('chat-header-review');
    await expect(reviewButton).toBeEnabled({ timeout: 15_000 });

    await reviewButton.click();
    await expect(page.getByTestId('review-modal')).toBeVisible({ timeout: 10_000 });
  });
});

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
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });

    const hideButton = page.getByTestId('chat-header-hide');
    await expect(hideButton).toBeEnabled();
    await hideButton.click();

    await expect(page.locator('[data-drop-surface="chat"]')).toHaveCount(0);
    await expect(page.getByTestId('chat-header')).toHaveCount(0);
    // Files remains the sole lit surface.
    await expect(page.getByTestId('files-surface')).toBeVisible();
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

  test('split-right lights a second surface beside Chat in the top row', async () => {
    const { page } = app;
    await page.getByTestId('chat-header-split-right').click();
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });

    const chatBox = await page.locator('[data-drop-surface="chat"]').boundingBox();
    const filesBox = await page.locator('[data-drop-surface="files"]').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(filesBox).not.toBeNull();
    // Same row: comparable y, Chat stays leftmost.
    expect(Math.abs(chatBox!.y - filesBox!.y)).toBeLessThan(5);
    expect(chatBox!.x).toBeLessThan(filesBox!.x);
  });

  test('split-down lights a third surface into the bottom strip', async () => {
    const { page } = app;
    // Chat's own header still carries the split controls regardless of how many
    // surfaces are already lit, as long as one of files/run is still missing.
    await page.getByTestId('chat-header-split-down').click();
    await expect(page.getByTestId('run-surface')).toBeVisible({ timeout: 5_000 });

    const filesBox = await page.locator('[data-drop-surface="files"]').boundingBox();
    const runBox = await page.locator('[data-drop-surface="run"]').boundingBox();
    expect(filesBox).not.toBeNull();
    expect(runBox).not.toBeNull();
    // Run sits below the top row.
    expect(runBox!.y).toBeGreaterThan(filesBox!.y + filesBox!.height - 5);
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
