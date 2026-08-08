/**
 * PermissionSelect — behavior tests.
 *
 * Behaviors covered:
 *  - Default label is "Interactive" when chat.permissionMode is unset and no
 *    provider default is configured.
 *  - Todo #235: a configured provider default permission mode
 *    (providerDefaults.defaultMode) shows pre-send when chat.permissionMode
 *    is unset — the composer must not silently show "Interactive" for a user
 *    who configured "Unattended" (yolo) as their default.
 *  - An explicit chat.permissionMode always wins over providerDefaults.defaultMode.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Chat, ProviderConfig } from '@qlan-ro/mainframe-types';
import { PermissionSelect } from '../PermissionSelect';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChat(overrides?: Partial<Chat>): Chat {
  return {
    id: 'chat-1',
    projectId: 'proj-1',
    adapterId: 'claude',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

function renderSelect(chat: Chat, providerDefaults?: ProviderConfig) {
  return render(
    <TooltipProvider>
      <PermissionSelect chat={chat} setPermissionMode={vi.fn()} providerDefaults={providerDefaults} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PermissionSelect — default label with no providerDefaults', () => {
  it('shows "Interactive" when chat.permissionMode is unset', () => {
    renderSelect(makeChat({ permissionMode: undefined }));
    expect(screen.getByTestId('composer-permission-mode-select').textContent).toContain('Interactive');
  });
});

describe('PermissionSelect — providerDefaults.defaultMode fallback', () => {
  it('shows "Unattended" when chat.permissionMode is unset but providerDefaults.defaultMode is yolo', () => {
    renderSelect(makeChat({ permissionMode: undefined }), { defaultMode: 'yolo' });
    expect(screen.getByTestId('composer-permission-mode-select').textContent).toContain('Unattended');
  });

  it('shows "Auto-Edits" when providerDefaults.defaultMode is acceptEdits', () => {
    renderSelect(makeChat({ permissionMode: undefined }), { defaultMode: 'acceptEdits' });
    expect(screen.getByTestId('composer-permission-mode-select').textContent).toContain('Auto-Edits');
  });
});

describe('PermissionSelect — explicit chat.permissionMode wins over providerDefaults', () => {
  it('shows "Auto-Edits" (chat mode) even when providerDefaults.defaultMode is yolo', () => {
    renderSelect(makeChat({ permissionMode: 'acceptEdits' }), { defaultMode: 'yolo' });
    expect(screen.getByTestId('composer-permission-mode-select').textContent).toContain('Auto-Edits');
  });
});
