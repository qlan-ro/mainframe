import type { Page } from '@playwright/test';
import { T } from './testids.js';

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
    // Verified: ProjectFilterPillBar renders pills with testid `sessions-filter-pill-<projectId>`.
    projectFilterPill: (projectId: string) => page.getByTestId(`sessions-filter-pill-${projectId}`),
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
    effortOption: (id: string) => page.getByTestId(`composer-effort-select-option-${id}`),
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
