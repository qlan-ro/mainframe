/**
 * §36 Codex plan-approval parity
 *
 * Opt-in smoke test: set E2E_CODEX=1 and ensure the `codex` CLI binary is on PATH.
 * Without the env var the test is skipped — CI does not install Codex by default.
 *
 * Flow under test:
 *   1. Create a Codex chat.
 *   2. Click the PlanModeToggle to enable plan mode.
 *   3. Send a prompt that triggers a plan.
 *   4. Wait for PlanApprovalCard.
 *   5. Approve — Codex exits plan mode.
 *   6. Assert toggle returns to inactive state.
 */
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { sendMessage, waitForAIIdle, waitForPlanCard } from '../helpers/wait.js';

const RUN_CODEX_E2E = process.env['E2E_CODEX'] === '1';

test.describe('§36 Codex plan approval', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    if (!RUN_CODEX_E2E) return;
    fixture = await launchApp();
    project = await createTestProject(fixture.page, {
      claudeMd:
        '# E2E Test Project\n\nThis is an automated test environment.\nIn plan mode, create a plan and call ExitPlanMode immediately after.\n',
    });
    await createTestChat(fixture.page, project.projectId, 'default', 'codex');
  });

  test.afterAll(async () => {
    if (!RUN_CODEX_E2E) return;
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('Codex plan-mode toggle surfaces PlanApprovalCard on exit prompt', async () => {
    test.skip(!RUN_CODEX_E2E, 'Codex E2E is opt-in — set E2E_CODEX=1 to run');

    const toggle = fixture.page.locator('[data-testid="plan-mode-toggle"]');

    // Toggle must be visible in the composer.
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-active', 'false');

    // Enable plan mode.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-active', 'true');

    // Send a prompt that reliably triggers a Codex plan.
    await sendMessage(fixture.page, 'Plan how to add a greeting function to utils.ts');

    // Wait for Codex to produce a PlanApprovalCard.
    await waitForPlanCard(fixture.page, 45_000);
    const card = fixture.page.locator('[data-testid="plan-approval-card"]');
    await expect(card).toBeVisible();

    // Approve the plan — Codex exits plan mode.
    await card.getByRole('button', { name: /approve plan/i }).click();

    // After approval the AI finishes its turn.
    await waitForAIIdle(fixture.page, 60_000);

    // Toggle must now be back to inactive — planMode was reset to false.
    await expect(toggle).toHaveAttribute('data-active', 'false');
  });

  test('toggle orthogonality — enabling plan mode does not change permissionMode', async () => {
    test.skip(!RUN_CODEX_E2E, 'Codex E2E is opt-in — set E2E_CODEX=1 to run');

    // Create a fresh Codex chat with acceptEdits permissionMode.
    await createTestChat(fixture.page, project.projectId, 'acceptEdits', 'codex');

    const toggle = fixture.page.locator('[data-testid="plan-mode-toggle"]');
    await expect(toggle).toBeVisible();

    // Toggle plan mode on and off — permissionMode should remain acceptEdits.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-active', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-active', 'false');

    // Send a simple message — must NOT surface a PlanApprovalCard.
    await sendMessage(fixture.page, 'What is 1 + 1? Answer with just the number.');
    const planCard = fixture.page.locator('[data-testid="plan-approval-card"]');
    const raced = await Promise.race([
      planCard.waitFor({ timeout: 10_000 }).then(() => 'plan-card' as const),
      waitForAIIdle(fixture.page, 30_000).then(() => 'idle' as const),
    ]);
    expect(raced).toBe('idle');
  });
});
