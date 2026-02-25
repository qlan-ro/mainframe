import type { Page } from '@playwright/test';

/**
 * Creates a new chat for the given project with the specified permissionMode,
 * then waits for the renderer to navigate to the new chat tab.
 *
 * Use this instead of Meta+n when the test needs a specific permissionMode.
 * E.g. pass 'acceptEdits' so file-editing tests never stall on a plan approval card.
 */
export async function createTestChat(
  page: Page,
  projectId: string,
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'yolo' = 'default',
): Promise<void> {
  await page.evaluate(
    ({ pid, mode }) => {
      const client = (window as any).__daemonClient;
      if (!client) throw new Error('__daemonClient not exposed on window');
      client.createChat(pid, 'claude', undefined, mode);
    },
    { pid: projectId, mode: permissionMode },
  );
  // Wait for the new chat's composer — renderer opens the tab on chat.created
  await page.getByRole('textbox').waitFor({ timeout: 10_000 });
}
