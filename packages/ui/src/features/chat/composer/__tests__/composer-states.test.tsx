/**
 * Composer visual-state behavior tests — Phase 3 parity fixes.
 *
 * Covers:
 *  1. ProviderModelSelect footer in BOTH locked and unlocked states
 *  2. PermissionSelect per-option description notes
 *
 * Each test asserts hardcoded expected values against the rendered DOM —
 * never derives expectations from the component's own logic.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Subject imports
// ---------------------------------------------------------------------------

import { ProviderModelSelect } from '../config-toolbar/ProviderModelSelect';
import { PermissionSelect } from '../config-toolbar/PermissionSelect';
import type { AdapterInfo, AdapterModel, Chat } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    temporary: false,
    noProject: false,
    ...overrides,
  };
}

const MODEL_WITH_EFFORTS: AdapterModel = {
  id: 'sonnet',
  label: 'Claude Sonnet 4',
  supportedEfforts: ['low', 'medium', 'high'],
  supportsUltracode: false,
  supportsFast: false,
  supportsAdaptiveThinking: false,
};

const ADAPTER_CLAUDE: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: 'Anthropic Claude',
  installed: true,
  models: [MODEL_WITH_EFFORTS],
  capabilities: { planMode: false },
};

const ADAPTER_GEMINI: AdapterInfo = {
  id: 'gemini',
  name: 'Gemini',
  description: 'Google Gemini',
  installed: true,
  models: [{ id: 'gemini-flash', label: 'Gemini Flash' }],
  capabilities: { planMode: false },
};

// ---------------------------------------------------------------------------
// 5. ProviderModelSelect — footer in BOTH locked and unlocked states
// ---------------------------------------------------------------------------

describe('ProviderModelSelect — footer shows in both locked and unlocked states', () => {
  async function openPopover(locked: boolean) {
    render(
      <TooltipProvider>
        <ProviderModelSelect
          chat={makeChat({ adapterId: 'claude', model: 'sonnet' })}
          adapters={[ADAPTER_CLAUDE, ADAPTER_GEMINI]}
          adapter={ADAPTER_CLAUDE}
          model={MODEL_WITH_EFFORTS}
          locked={locked}
          disabled={false}
          setAdapter={vi.fn()}
          setModel={vi.fn()}
          setEffort={vi.fn()}
          setFeature={vi.fn()}
        />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('composer-model-select'));
  }

  it('locked=true shows the switching footer', async () => {
    await openPopover(true);
    const footer = screen.getByTestId('composer-provider-footer');
    expect(footer.textContent).toBe(
      'Switching keeps this chat. The new provider gets its history with your next message.',
    );
  });

  it('locked=false shows "Pick a provider before your first message."', async () => {
    await openPopover(false);
    const footer = screen.getByTestId('composer-provider-footer');
    expect(footer.textContent).toBe('Pick a provider before your first message.');
  });
});

// ---------------------------------------------------------------------------
// 6. PermissionSelect — per-option description notes
// ---------------------------------------------------------------------------

describe('PermissionSelect — dropdown items render description notes', () => {
  it('Interactive option renders its description note "Approve every action"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const interactive = screen.getByTestId('composer-permission-mode-select-option-default');
    expect(interactive.textContent).toContain('Approve every action');
  });

  it('Auto-Edits option renders its description note "Edits applied, commands ask"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const autoEdits = screen.getByTestId('composer-permission-mode-select-option-acceptEdits');
    expect(autoEdits.textContent).toContain('Edits applied, commands ask');
  });

  it('Unattended option renders its description note "Runs without prompts"', async () => {
    render(
      <TooltipProvider>
        <PermissionSelect chat={makeChat()} setPermissionMode={vi.fn()} />
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByTestId('composer-permission-mode-select'));

    const unattended = screen.getByTestId('composer-permission-mode-select-option-yolo');
    expect(unattended.textContent).toContain('Runs without prompts');
  });
});
