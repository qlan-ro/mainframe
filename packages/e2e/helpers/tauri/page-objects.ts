import type { Page } from '@playwright/test';
import { T, WORKSPACE } from './testids.js';

export function sessionsSidebar(page: Page) {
  return {
    row: (chatId: string) => page.locator(`[data-testid="${T.sessionRow}"][data-chat-id="${chatId}"]`),
    newButton: () => page.getByTestId(T.sessionsNewButton),
    async openMore() {
      await page.getByTestId(T.sessionsMoreButton).click();
    },
    async openImport() {
      await this.openMore();
      await page.getByTestId('sessions-more-import').click();
    },
    async openArchived() {
      await this.openMore();
      await page.getByTestId('sessions-more-archived').click();
    },
    importProjectOption: (projectId: string) => page.getByTestId(`sessions-import-project-${projectId}`),
    /** One row of the sidebar's project switcher. The v1 pill cloud
     *  (`sessions-filter-pill-<id>`) died with ProjectFilterPillBar; v2's
     *  ProjectSection renders a vertical list of `sidebar-project-<id>` rows,
     *  plus `sidebar-project-all` for the clear-filter row. */
    projectRow: (projectId: string) => page.getByTestId(`sidebar-project-${projectId}`),
    allProjectsRow: () => page.getByTestId('sidebar-project-all'),
  };
}

export function composer(page: Page) {
  return {
    input: () => page.getByTestId(T.composerInput),
    send: () => page.getByTestId(T.composerSend),
    async type(text: string) {
      await this.input().fill(text);
    },
    async submit(text: string) {
      await this.type(text);
      await this.send().click();
    },
    modelOption: (id: string) => page.getByTestId(`composer-model-select-option-${id}`),
    /** Effort now lives in a model row's flyout, keyed by the model it belongs to. */
    modelEffortOption: (modelId: string, level: string) =>
      page.getByTestId(`composer-model-${modelId}-effort-${level}`),
    permissionModeOption: (id: string) => page.getByTestId(`composer-permission-mode-select-option-${id}`),
  };
}

export function chatThread(page: Page) {
  return {
    root: () => page.getByTestId(T.thread),
    userMessages: () => page.getByTestId(T.userMessage),
    assistantMessages: () => page.getByTestId(T.assistantMessage),
  };
}

/**
 * The workspace surface (merged Files+Run, 2026-08-05).
 *
 * `openFilePicker` exists because the "open a file" affordance moved with the
 * merge: an empty workspace offers it as a row on the empty-state card, and a
 * workspace with tabs offers it inside the pane's `+` menu. Every spec that used
 * the old always-present `files-tab-strip-add` needs both branches.
 */
/**
 * Idempotent "show the Files tree". `main-toolbar-files` is a toggle over
 * ON-SCREEN visibility (tree expanded AND workspace surface lit) — an
 * unconditional click against a long-lived page would collapse an already
 * visible tree. Only clicks when the sidebar isn't showing.
 */
export async function showFilesTree(page: Page): Promise<void> {
  if ((await page.getByTestId('workspace-files-sidebar').count()) === 0) {
    await page.getByTestId('main-toolbar-files').click();
  }
  await page.getByTestId('file-tree').waitFor({ timeout: 10_000 });
}

export function workspace(page: Page) {
  return {
    root: () => page.getByTestId('workspace-surface'),
    emptyState: () => page.getByTestId('workspace-empty-state'),
    strip: () => page.locator(WORKSPACE.strip),
    panes: () => page.locator(WORKSPACE.pane),
    tabs: () => page.locator(WORKSPACE.tab),
    tab: (title: string) => page.locator(WORKSPACE.tab).filter({ hasText: title }),
    activeTab: () => page.locator(`${WORKSPACE.tab}[aria-selected="true"]`),
    /** Resolve the first pane's opaque id, for the per-pane testids. */
    async firstPaneId(): Promise<string> {
      const testid = await page.locator(WORKSPACE.pane).first().getAttribute('data-testid');
      if (!testid) throw new Error('no workspace pane is mounted');
      return testid.replace('workspace-pane-', '');
    },
    async openAddMenu(): Promise<string> {
      const paneId = await this.firstPaneId();
      await page.getByTestId(`workspace-tab-strip-add-${paneId}`).click();
      await page.getByTestId(`workspace-add-menu-${paneId}`).waitFor({ timeout: 5_000 });
      return paneId;
    },
    /** Open the file picker from whichever affordance the current state offers. */
    async openFilePicker(): Promise<void> {
      if ((await page.locator(WORKSPACE.add).count()) > 0) {
        const paneId = await this.openAddMenu();
        await page.getByTestId(`workspace-pane-open-file-${paneId}`).click();
        return;
      }
      await page.getByTestId('workspace-picker-open-file').click();
    },
  };
}
