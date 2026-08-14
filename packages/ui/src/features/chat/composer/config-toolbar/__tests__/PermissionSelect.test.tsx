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
 *  - Todo #325: the Claude-only 'auto' mode is offered only when the resolved
 *    adapter advertises capabilities.autoMode, its label still resolves when the
 *    option is filtered out, and it reads as a caution rather than as the
 *    destructive treatment Unattended keeps.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AdapterInfo, Chat, ProviderConfig } from '@qlan-ro/mainframe-types';
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

function makeAdapter(capabilities: AdapterInfo['capabilities']): AdapterInfo {
  return {
    id: 'claude',
    name: 'Claude',
    description: '',
    installed: true,
    models: [],
    capabilities,
  };
}

function renderSelect(chat: Chat, providerDefaults?: ProviderConfig, adapter?: AdapterInfo) {
  return render(
    <TooltipProvider>
      <PermissionSelect chat={chat} setPermissionMode={vi.fn()} providerDefaults={providerDefaults} adapter={adapter} />
    </TooltipProvider>,
  );
}

/** Radix menus open on pointerdown, not click. */
async function openMenu(): Promise<void> {
  fireEvent.pointerDown(screen.getByTestId('composer-permission-mode-select'), { button: 0 });
  await screen.findByTestId('composer-permission-mode-select-option-default');
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

describe('PermissionSelect — Auto is gated on the adapter capability (todo #325)', () => {
  it('offers Auto when the adapter advertises capabilities.autoMode', async () => {
    renderSelect(makeChat(), undefined, makeAdapter({ planMode: true, autoMode: true }));
    await openMenu();
    expect(screen.getByTestId('composer-permission-mode-select-option-auto')).toBeTruthy();
  });

  it('omits Auto when the adapter reports autoMode: false', async () => {
    renderSelect(makeChat(), undefined, makeAdapter({ planMode: true, autoMode: false }));
    await openMenu();
    expect(screen.queryByTestId('composer-permission-mode-select-option-auto')).toBeNull();
  });

  it('omits Auto when the capabilities object has no autoMode key (placeholder adapter)', async () => {
    renderSelect(makeChat(), undefined, makeAdapter({ planMode: false }));
    await openMenu();
    expect(screen.queryByTestId('composer-permission-mode-select-option-auto')).toBeNull();
  });

  it('omits Auto when no adapter is resolved yet', async () => {
    renderSelect(makeChat());
    await openMenu();
    expect(screen.queryByTestId('composer-permission-mode-select-option-auto')).toBeNull();
  });

  it('labels the trigger "Auto" for a stored auto mode even with no adapter resolved', () => {
    renderSelect(makeChat({ permissionMode: 'auto' }));
    expect(screen.getByTestId('composer-permission-mode-select').textContent).toContain('Auto');
    expect(screen.getByTestId('composer-permission-mode-select').textContent).not.toContain('auto');
  });
});

describe('PermissionSelect — Auto reads as caution, Unattended stays destructive (todo #325)', () => {
  it('tints the trigger text-warning when Auto is the current mode', () => {
    renderSelect(makeChat({ permissionMode: 'auto' }));
    const trigger = screen.getByTestId('composer-permission-mode-select');
    expect(trigger.className).toContain('text-warning');
    expect(trigger.className).not.toContain('text-destructive');
  });

  it('keeps the trigger text-destructive when Unattended is the current mode', () => {
    renderSelect(makeChat({ permissionMode: 'yolo' }));
    const trigger = screen.getByTestId('composer-permission-mode-select');
    expect(trigger.className).toContain('text-destructive');
    expect(trigger.className).not.toContain('text-warning');
  });

  it('gives the Auto option the warning tint and Unattended the destructive one', async () => {
    renderSelect(makeChat(), undefined, makeAdapter({ planMode: true, autoMode: true }));
    await openMenu();

    const autoLabel = within(screen.getByTestId('composer-permission-mode-select-option-auto')).getByText('Auto');
    expect(autoLabel.className).toContain('text-warning');
    expect(autoLabel.className).not.toContain('text-destructive');

    const yoloLabel = within(screen.getByTestId('composer-permission-mode-select-option-yolo')).getByText('Unattended');
    expect(yoloLabel.className).toContain('text-destructive');
    expect(yoloLabel.className).not.toContain('text-warning');
  });
});
