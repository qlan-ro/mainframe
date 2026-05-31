import type { Page } from '@playwright/test';

/**
 * Creates a new chat for the given project, then waits for the renderer to open the chat tab.
 *
 * Use this instead of Meta+n when the test needs a specific mode. Pass 'acceptEdits' so
 * file-editing tests never stall on a plan card, or 'plan' to start in plan mode.
 *
 * Note: plan mode is no longer a permission mode (it became a standalone composer toggle), so
 * 'plan' creates a default-permission chat and then flips the plan-mode toggle.
 */
export async function createTestChat(
  page: Page,
  projectId: string,
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'yolo' = 'default',
  adapterId = 'claude',
): Promise<void> {
  const wantsPlanMode = permissionMode === 'plan';
  // createChat's permissionMode no longer accepts 'plan'; map it to 'default' (cast is safe — the
  // 'plan' case is handled separately via the toggle below).
  const createMode = wantsPlanMode ? 'default' : (permissionMode as 'default' | 'acceptEdits' | 'yolo');

  await page.evaluate(
    ({ pid, adapter, mode }) => {
      const client = (window as any).__daemonClient;
      if (!client) throw new Error('__daemonClient not exposed on window');
      client.createChat(pid, adapter, undefined, mode);
    },
    { pid: projectId, adapter: adapterId, mode: createMode },
  );

  // Wait for the new chat's composer — renderer opens the tab on chat.created.
  const textbox = page.getByRole('textbox').first();
  try {
    await textbox.waitFor({ timeout: 12_000 });
  } catch {
    // The chat.created event (which opens the tab) is occasionally missed. Reload to force a full
    // chat resync from the daemon — useAppInit restores the most-recent chat and shows the composer.
    await page.reload();
    await page
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });
    await textbox.waitFor({ timeout: 15_000 });
  }

  // Plan mode is a standalone composer toggle now — enable it for plan-mode chats.
  if (wantsPlanMode) {
    const toggle = page.locator('[data-testid="plan-mode-toggle"]');
    await toggle.waitFor({ timeout: 10_000 });
    if ((await toggle.getAttribute('aria-label'))?.includes('disabled')) {
      await toggle.click();
    }
  }
}
